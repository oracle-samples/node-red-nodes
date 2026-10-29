/* Copyright (c) 2026 Oracle and/or its affiliates. Licensed under the UPL, Version 1.0. */

var diagnosticText = require("./diagnostic-text.js");

// Kept identical in the independently installable DB and OCI packages.
var guarded = new WeakSet();

function redactText(value) {
    var text = diagnosticText.redactJwt(diagnosticText.boundedText(value), "[redacted token]")
        .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, "[redacted private key]")
        .replace(/(^|\r?\n)((?:set-)?cookie|(?:proxy-)?authorization)\s*:[^\r\n]*/gi, "$1$2: [redacted]")
        .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
        .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi, "[redacted authorization]")
        .replace(/(["']?\b(?:authorization|proxy-authorization|cookie|set-cookie)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,;]+)/gi, "$1[redacted]");
    return diagnosticText.redactAssignments(text, "[redacted]");
}

function redactBody(text) {
    try {
        var body = JSON.parse(text);
        // These are the only response fields used to construct the SDK's OciError.
        if (body && body.code && body.message) {
            return JSON.stringify({ code: body.code, message: redactText(body.message) });
        }
    } catch (err) {
        // Plain text error bodies use the same diagnostic boundary.
    }
    return redactText(text);
}

function diagnosticValue(value, seen, depth) {
    if (typeof value === "string") return redactText(value);
    if (typeof value === "bigint") return String(value);
    if (typeof value === "function") return "[diagnostic function omitted]";
    if (!value || typeof value !== "object") return value;
    if (depth >= 8) return "[nested diagnostic omitted]";
    if (seen.has(value)) return "[circular diagnostic omitted]";
    seen.add(value);
    var result = Array.isArray(value) ? [] : {};
    var keys = Object.keys(value);
    if (value instanceof Error) keys = Array.from(new Set(keys.concat(["message", "stack"])));
    keys.forEach(function (key) {
        var sensitive = /password|passwd|passphrase|secret|authorization|cookie|token|privatekey/i.test(key.replace(/[_-]/g, ""));
        Object.defineProperty(result, key, {
            value: sensitive ? "[redacted]" : diagnosticValue(value[key], seen, depth + 1),
            enumerable: true, configurable: true, writable: true
        });
    });
    seen.delete(value);
    return result;
}

function safeDiagnostic(value) {
    try { return diagnosticValue(value, new Set(), 0); }
    catch (err) { return "[diagnostic omitted]"; }
}

function redactError(err, seen) {
    if (typeof err === "string") return redactText(err);
    if (!err || typeof err !== "object") return err;
    seen = seen || new Map();
    if (seen.has(err)) return seen.get(err);
    if (seen.size >= 8) return err;
    var fields = ["message", "stack", "requestEndpoint", "troubleshootingTips"];
    var descriptors = Object.getOwnPropertyDescriptors(err);
    var immutable = !Object.isExtensible(err) || fields.concat(["errorObject", "toJSON"]).some(function (field) {
        return descriptors[field] && descriptors[field].configurable === false;
    });
    var original = err;
    if (immutable) {
        // Keep classification fields and the Error prototype when a transport freezes its error.
        err = Object.create(Object.getPrototypeOf(original));
        Reflect.ownKeys(descriptors).forEach(function (key) {
            var descriptor = descriptors[key];
            descriptor.configurable = true;
            if (Object.prototype.hasOwnProperty.call(descriptor, "value")) descriptor.writable = true;
            Object.defineProperty(err, key, descriptor);
        });
    }
    seen.set(original, err);
    fields.forEach(function (field) {
        if (typeof err[field] === "string") Object.defineProperty(err, field, {
            value: redactText(err[field]), writable: true, configurable: true,
            enumerable: !!(descriptors[field] && descriptors[field].enumerable)
        });
    });
    if (err.errorObject) Object.defineProperty(err, "errorObject", {
        value: redactError(err.errorObject, seen), enumerable: true, configurable: true, writable: true
    });
    // Circuit diagnostics serialize the wrapper, which may also contain response headers/body.
    Object.defineProperty(err, "toJSON", {
        configurable: true, enumerable: false,
        value: function () { return safeDiagnostic(err); }
    });
    return err;
}

function guardResponse(response) {
    if (!response || (response.status >= 200 && response.status <= 299)) return response;
    if (typeof response.text !== "function") return redactError(response);
    return new Proxy(response, {
        get: function (target, property) {
            if (property === "text") return async function () {
                try { return redactBody(await target.text()); }
                catch (err) { throw redactError(err); }
            };
            if (property === "clone") return function () { return guardResponse(target.clone()); };
            var value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
        }
    });
}

function guardLogger(client) {
    var owner = client;
    var descriptor;
    while (owner && !descriptor) {
        descriptor = Object.getOwnPropertyDescriptor(owner, "logger");
        owner = Object.getPrototypeOf(owner);
    }
    if (!descriptor || descriptor.configurable === false) return;
    var source;
    var safe;
    Object.defineProperty(client, "logger", {
        configurable: true,
        get: function () {
            var logger = descriptor.get ? descriptor.get.call(client) : descriptor.value;
            if (!logger) return logger;
            if (source !== logger) {
                source = logger;
                safe = Object.create(logger);
                ["debug", "info", "warn", "error", "log"].forEach(function (level) {
                    if (typeof logger[level] !== "function") return;
                    Object.defineProperty(safe, level, { value: function () {
                        var args = Array.prototype.map.call(arguments, function (value) {
                            var diagnostic = safeDiagnostic(value);
                            return diagnostic && typeof diagnostic === "object" ? JSON.stringify(diagnostic) : diagnostic;
                        });
                        return logger[level].apply(logger, args);
                    }, configurable: true, writable: true });
                });
            }
            return safe;
        }
    });
}

module.exports = function guardSdkDiagnostics(client) {
    if (guarded.has(client)) return client;
    guarded.add(client);
    guardLogger(client);

    var transport = client._httpClient;
    if (transport && typeof transport.send === "function") {
        var send = transport.send;
        var ownedTransport = Object.create(transport);
        ownedTransport.send = async function () {
            try { return guardResponse(await send.apply(transport, arguments)); }
            catch (err) { throw redactError(err); }
        };
        client._httpClient = ownedTransport;
    }

    var circuit = client._circuitBreaker;
    if (circuit && typeof circuit.action === "function") {
        var action = circuit.action;
        // The SDK's circuit error filter logs before the retrier receives the response.
        circuit.action = async function () {
            try { return await action.apply(this, arguments); }
            catch (err) { throw redactError(err); }
        };
    }
    return client;
};

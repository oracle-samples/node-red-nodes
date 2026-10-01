var endpointSupport = require("./oci-endpoint.js");

function validationError(message) {
    var err = new Error(message);
    err.isValidation = true;
    return err;
}

function validateEndpoint(value) {
    if (typeof value !== "string" || !value.trim()) {
        throw validationError("Messages Endpoint is required");
    }
    var parsed;
    try {
        parsed = new URL(value.trim());
    } catch (err) {
        throw validationError("Messages Endpoint must be a valid HTTPS OCI Queue endpoint");
    }
    if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        (parsed.pathname && parsed.pathname !== "/") ||
        parsed.search ||
        parsed.hash ||
        (parsed.port && parsed.port !== "443") ||
        !endpointSupport.matchesKnownRealm(
            parsed.hostname,
            /^[a-z0-9-]+\.queue\.messaging\.[a-z0-9-]+\.oci\.([a-z0-9.-]+)$/i
        )
    ) {
        throw validationError("Messages Endpoint must be an HTTPS OCI Queue messages endpoint without a path, query, or credentials");
    }
    return parsed.origin;
}

function serializeContent(value, fieldName) {
    var name = fieldName || "msg.payload";
    if (typeof value === "string") return value;
    if (Buffer.isBuffer(value)) {
        throw validationError(name + " does not support buffers; encode binary content explicitly as a string");
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw validationError(name + " must be a finite number");
        return String(value);
    }
    if (typeof value === "boolean") return String(value);
    if (value === null || typeof value === "object") {
        try {
            var serialized = JSON.stringify(value);
            if (serialized === undefined) throw new Error("empty JSON result");
            return serialized;
        } catch (err) {
            throw validationError(name + " must be JSON-serializable");
        }
    }
    throw validationError(name + " has an unsupported value type");
}

function normalizeMetadata(value) {
    if (value === undefined || value === null) return undefined;
    if (!isPlainObject(value)) throw validationError("Queue metadata must be a plain object");
    if (typeof value.channelId !== "string" || !value.channelId.trim()) {
        throw validationError("Queue metadata channelId is required");
    }
    var metadata = { channelId: value.channelId.trim() };
    if (value.customProperties !== undefined) {
        if (!isPlainObject(value.customProperties)) {
            throw validationError("Queue metadata customProperties must be a plain object of strings");
        }
        var properties = {};
        Object.keys(value.customProperties).forEach(function (name) {
            if (typeof value.customProperties[name] !== "string") {
                throw validationError("Queue metadata customProperties values must be strings");
            }
            Object.defineProperty(properties, name, {
                value: value.customProperties[name],
                enumerable: true,
                writable: true,
                configurable: true
            });
        });
        metadata.customProperties = properties;
    }
    return metadata;
}

function buildMessages(payload, input) {
    input = input && isPlainObject(input) ? input : {};
    if (input.messages !== undefined) {
        if (!Array.isArray(input.messages) || !input.messages.length) {
            throw validationError("msg.ociQueue.messages must be a non-empty array");
        }
        if (input.messages.length > 20) {
            throw validationError("msg.ociQueue.messages supports at most 20 messages");
        }
        return input.messages.map(function (entry, index) {
            if (!isPlainObject(entry) || !Object.prototype.hasOwnProperty.call(entry, "content")) {
                throw validationError("msg.ociQueue.messages[" + index + "].content is required");
            }
            return buildEntry(entry.content, entry.metadata, "msg.ociQueue.messages[" + index + "].content");
        });
    }
    return [buildEntry(payload, input.metadata, "msg.payload")];
}

function buildEntry(content, metadata, fieldName) {
    var entry = { content: serializeContent(content, fieldName) };
    var normalizedMetadata = normalizeMetadata(metadata);
    if (normalizedMetadata) entry.metadata = normalizedMetadata;
    return entry;
}

function parseContent(value) {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value);
    } catch (err) {
        return value;
    }
}

function reattachTransaction(input, output) {
    if (!input.transaction) return;
    Object.defineProperty(output, "transaction", {
        value: input.transaction,
        enumerable: false,
        writable: true,
        configurable: true
    });
}

function isPlainObject(value) {
    if (!value || Object.prototype.toString.call(value) !== "[object Object]") return false;
    var prototype = Object.getPrototypeOf(value);
    if (prototype === null) return true;
    // Function-node objects have a different realm's Object.prototype.
    var constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
    return Object.getPrototypeOf(prototype) === null &&
        constructor && typeof constructor.value === "function" && constructor.value.prototype === prototype &&
        Function.prototype.toString.call(constructor.value) === Function.prototype.toString.call(Object);
}

module.exports = {
    validationError: validationError,
    validateEndpoint: validateEndpoint,
    serializeContent: serializeContent,
    normalizeMetadata: normalizeMetadata,
    buildMessages: buildMessages,
    parseContent: parseContent,
    reattachTransaction: reattachTransaction
};

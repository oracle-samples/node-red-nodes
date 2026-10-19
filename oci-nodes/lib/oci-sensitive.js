/*
 Copyright (c) 2026 Oracle and/or its affiliates.
 Licensed under the Universal Permissive License (UPL), Version 1.0.
*/

function output(msg, fields) {
    var result = Object.assign({}, msg, fields);
    if (msg.transaction) Object.defineProperty(result, "transaction", {
        value: msg.transaction, enumerable: false, writable: true, configurable: true
    });
    return result;
}

function required(value, label) {
    if (typeof value !== "string" || !value.trim()) throw new Error(label + " is required");
    return value.trim();
}

function option(value, fallback) {
    return value === undefined || value === "" ? fallback : value;
}

function selector(config) {
    if (config.versionNumber !== undefined && config.versionNumber !== "") {
        var value = config.versionNumber;
        if (typeof value !== "number" && (typeof value !== "string" || !/^[0-9]+$/.test(value))) {
            throw new Error("Version must be a positive integer");
        }
        var number = Number(value);
        if (!Number.isSafeInteger(number) || number <= 0) throw new Error("Version must be a positive integer");
        return { versionNumber: number };
    }
    var stage = option(config.stage, "CURRENT");
    if (["CURRENT", "PENDING", "LATEST", "PREVIOUS", "DEPRECATED"].indexOf(stage) === -1) {
        throw new Error("Invalid version stage");
    }
    return { stage: stage };
}

function fail(node, msg, done, label, validation, err, code) {
    // SDK errors can contain response bodies with secret material. Do not forward them.
    var message = validation && !code ? err.message : label + " failed; check OCI permissions, resource and connectivity";
    if (code === "OCI_REQUEST_TIMEOUT") message = label + " timed out";
    if (code === "OCI_QUEUE_FULL") message = "Pending request limit reached";
    if (code === "OCI_NODE_CLOSED") message = "Node is stopping";
    var reported = new Error(message);
    reported.code = code || (validation ? "OCI_INPUT_INVALID" : "OCI_REQUEST_FAILED");
    msg.error = { message: message, code: reported.code };
    node.status({ fill: "red", shape: validation ? "ring" : "dot", text: validation ? "invalid configuration" : "request failed" });
    done(reported);
}

function limit(value, fallback, maximum, minimum, label) {
    value = value === undefined ? fallback : value;
    if (typeof value !== "number" && (typeof value !== "string" || !/^[0-9]+$/.test(value))) {
        throw new Error(label + " must be a whole number");
    }
    var number = Number(value);
    if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
        throw new Error(label + " is outside the supported range");
    }
    return number;
}

function clientConfiguration(common, signal) {
    return {
        // SDK diagnostics otherwise print raw service errors before our Catch handler runs.
        retryConfiguration: Object.assign({}, common.NoRetryConfigurationDetails, {
            retryCondition: function (err) {
                err.message = "OCI request failed";
                err.serviceCode = "OCI_REQUEST_FAILED";
                return false;
            }
        }),
        // A one-request client gains no shared protection from a circuit breaker.
        circuitBreaker: new common.CircuitBreaker({ disableClientCircuitBreaker: true }),
        httpOptions: { signal: signal }
    };
}

function lifecycle(node, config, label) {
    var closed = false;
    var active = new Set();
    var queue = [];
    var settings;
    var invalid;
    try {
        settings = {
            maxConcurrent: limit(config.maxConcurrent, 4, 32, 1, "Concurrent requests"),
            maxQueue: limit(config.maxQueue, 100, 10000, 1, "Pending requests"),
            timeoutMs: limit(config.timeoutMs, 30000, 300000, 1000, "Timeout")
        };
    } catch (err) { invalid = err; }

    function dispose(job) {
        job.clients.forEach(function (client) {
            job.clients.delete(client);
            // client.close() also closes OCI Config's shared authentication provider.
            try { client.shutdownCircuitBreaker(); }
            catch (err) { node.warn("Owned OCI client cleanup failed"); }
        });
    }

    function finish(job, code, fields) {
        if (job.settled) return;
        if (!code && Date.now() >= job.deadline) code = "OCI_REQUEST_TIMEOUT";
        job.settled = true;
        clearTimeout(job.timer);
        var queuedIndex = queue.indexOf(job);
        if (queuedIndex !== -1) queue.splice(queuedIndex, 1);
        var msg = job.msg;
        var send = job.send;
        var done = job.done;
        job.msg = job.send = job.done = null;
        if (code) {
            job.controller.abort();
            dispose(job);
            fail(node, msg, done, label, code === "OCI_QUEUE_FULL", null, code);
            return;
        }
        try { send(output(msg, fields)); }
        catch (err) { fail(node, msg, done, label, false, err); return; }
        node.status({ fill: "green", shape: "dot", text: "retrieved" });
        done();
    }

    function drain() {
        while (!closed && active.size < settings.maxConcurrent && queue.length) {
            run(queue.shift());
        }
    }

    function run(job) {
        active.add(job);
        node.status({ fill: "yellow", shape: "dot", text: "retrieving" });
        var operation = {
            signal: job.controller.signal,
            check: function () {
                if (!job.settled && Date.now() >= job.deadline) finish(job, "OCI_REQUEST_TIMEOUT");
                if (job.settled || closed) throw new Error("Request cancelled");
            },
            own: function (client) {
                job.clients.add(client);
                Object.defineProperty(client, "logger", { value: null, configurable: true });
                if (job.settled || closed) dispose(job);
                operation.check();
                return client;
            }
        };
        Promise.resolve().then(function () { operation.check(); return job.work(operation); }).then(function (fields) {
            finish(job, null, fields);
        }, function () {
            finish(job, "OCI_REQUEST_FAILED");
        }).finally(function () {
            job.work = null;
            dispose(job);
            // A deadline does not free a slot until the underlying auth/request settles.
            active.delete(job);
            drain();
        });
    }

    node.on("close", function (removed, done) {
        closed = true;
        queue.slice().forEach(function (job) { finish(job, "OCI_NODE_CLOSED"); });
        active.forEach(function (job) { finish(job, "OCI_NODE_CLOSED"); dispose(job); });
        done();
    });

    return {
        submit: function (msg, send, done, work) {
            if (invalid) { fail(node, msg, done, label, true, invalid); return; }
            if (closed) { fail(node, msg, done, label, false, null, "OCI_NODE_CLOSED"); return; }
            if (active.size >= settings.maxConcurrent && queue.length >= settings.maxQueue) {
                fail(node, msg, done, label, true, null, "OCI_QUEUE_FULL"); return;
            }
            var job = { msg: msg, send: send, done: done, work: work, clients: new Set(),
                controller: new AbortController(), settled: false, deadline: Date.now() + settings.timeoutMs };
            job.timer = setTimeout(function () { finish(job, "OCI_REQUEST_TIMEOUT"); }, settings.timeoutMs);
            job.timer.unref();
            if (active.size < settings.maxConcurrent) run(job);
            else {
                queue.push(job);
                node.status({ fill: "yellow", shape: "ring", text: "waiting" });
            }
        }
    };
}

module.exports = { output: output, required: required, option: option, selector: selector, fail: fail,
    clientConfiguration: clientConfiguration, lifecycle: lifecycle };

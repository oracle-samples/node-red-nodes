/*
 Copyright (c) 2026 Oracle and/or its affiliates.
 Licensed under the Universal Permissive License (UPL), Version 1.0.
*/

var ociError = require("./oci-error.js");

module.exports = function (node, config, labels) {
    var active = new Set();
    var queue = [];
    var closed = false;
    var timeout = config.timeoutMs === undefined ? 30000 : config.timeoutMs;
    var valid = (typeof timeout === "number" || (typeof timeout === "string" && /^\d+$/.test(timeout))) &&
        Number.isSafeInteger(Number(timeout)) && Number(timeout) >= 1000 && Number(timeout) <= 300000;

    function failure(code, message, validation) {
        var err = new Error(message);
        err.code = code;
        err.monitoringLimit = true;
        err.isValidationError = !!validation;
        return err;
    }

    function report(msg, done, err) {
        // A late result must not overwrite the status of a stopped node.
        if (closed) {
            var diagnostic = ociError.normalizeError(err);
            msg.error = { message: diagnostic.message, code: diagnostic.code };
            var reported = new Error(diagnostic.message);
            reported.code = diagnostic.code;
            done(reported);
            return;
        }
        ociError.handleNodeError(node, msg, err, done, {
            setPayload: err.monitoringLimit ? false : undefined,
            statusShape: err.isValidationError ? "ring" : "dot",
            statusText: err.isValidationError ? labels.invalid : labels.failed
        });
    }

    function finish(job, err, result) {
        if (job.settled) return;
        if (!err && Date.now() >= job.deadline) err = failure("MonitoringTimeout", "OCI Monitoring operation timed out");
        job.settled = true;
        clearTimeout(job.timer);
        var index = queue.indexOf(job);
        if (index !== -1) queue.splice(index, 1);
        var msg = job.msg;
        var send = job.send;
        var done = job.done;
        job.msg = job.send = job.done = job.work = null;
        if (err) { report(msg, done, err); return; }
        try { send(result); }
        catch (sendError) { report(msg, done, sendError); return; }
        node.status({ fill: "green", shape: "dot", text: labels.success });
        done();
    }

    function check(job) {
        if (closed) throw failure("MonitoringNodeClosed", "OCI Monitoring node is stopping");
        if (job.settled || Date.now() >= job.deadline) throw failure("MonitoringTimeout", "OCI Monitoring operation timed out");
    }

    function drain() {
        while (!closed && active.size < 4 && queue.length) run(queue.shift());
    }

    function run(job) {
        active.add(job);
        Promise.resolve().then(function () {
            check(job);
            node.status({ fill: "yellow", shape: "dot", text: labels.running });
            return job.work(function () { check(job); });
        }).then(function (result) {
            finish(job, null, result);
        }, function (err) {
            finish(job, err);
        }).finally(function () {
            // Reporting a timeout does not mean the SDK/authentication work has stopped.
            active.delete(job);
            drain();
        });
    }

    node.on("close", function (removed, done) {
        closed = true;
        queue.slice().concat(Array.from(active)).forEach(function (job) {
            finish(job, failure("MonitoringNodeClosed", "OCI Monitoring node is stopping"));
        });
        if (typeof removed === "function") removed();
        else if (typeof done === "function") done();
    });

    return function submit(msg, send, done, work) {
        if (closed) { report(msg, done, failure("MonitoringNodeClosed", "OCI Monitoring node is stopping")); return; }
        if (!valid) { report(msg, done, failure("MonitoringInvalidTimeout", "Timeout must be a whole number from 1000 to 300000 ms", true)); return; }
        if (active.size >= 4 && queue.length >= 100) {
            report(msg, done, failure("MonitoringQueueFull", "OCI Monitoring pending request limit reached", true));
            return;
        }
        var job = { msg: msg, send: send, done: done, work: work, settled: false, deadline: Date.now() + Number(timeout) };
        job.timer = setTimeout(function () {
            finish(job, failure("MonitoringTimeout", "OCI Monitoring operation timed out"));
        }, Number(timeout));
        job.timer.unref();
        if (active.size < 4) run(job);
        else {
            queue.push(job);
            node.status({ fill: "yellow", shape: "ring", text: "waiting" });
        }
    };
};

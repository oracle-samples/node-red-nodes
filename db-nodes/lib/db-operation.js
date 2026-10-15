/* Copyright (c) 2026 Oracle and/or its affiliates.
 * Licensed under the Universal Permissive License (UPL), Version 1.0.
 * https://oss.oracle.com/licenses/upl/
 */
var dbError = require("./db-error.js");

module.exports = function (node) {
    var closing = false;
    var pending = new Set();

    function assertOpen() {
        if (closing) {
            var error = new Error("DB node is closed");
            error.code = "DB_NODE_CLOSED";
            throw error;
        }
    }

    node.on("close", function (removed, done) {
        if (typeof removed === "function") done = removed;
        closing = true;
        // Keep ownership until late acquisitions and in-flight calls have settled.
        Promise.allSettled(Array.from(pending)).then(function () { done(); });
    });

    return {
        assertOpen: assertOpen,
        isClosing: function () { return closing; },
        stopped: function (error, lease, done) {
            if (lease) lease.transaction._rollbackOnly = true;
            if (error.code !== "DB_NODE_CLOSED") {
                node.warn("DB operation stopped: " + dbError.redactText(error.message));
            }
            done();
        },
        wrap: function (handler) {
            return function (msg, send, done) {
                var operation = Promise.resolve().then(function () {
                    return handler(msg, function (output) {
                        if (!closing) send(output);
                    }, done);
                });
                pending.add(operation);
                operation.then(function () { pending.delete(operation); }, function () { pending.delete(operation); });
                return operation;
            };
        }
    };
};

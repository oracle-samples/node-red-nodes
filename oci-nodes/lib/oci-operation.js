/* Copyright (c) 2026 Oracle and/or its affiliates. Licensed under the UPL, Version 1.0. */

module.exports = function createOperationState(node) {
    var controller = new AbortController();

    node.on("close", function (removed, done) {
        // A service node does not own its configuration's shared client or provider.
        controller.abort();
        if (typeof removed === "function") removed();
        else if (typeof done === "function") done();
    });

    return {
        signal: controller.signal,
        isClosed: function () { return controller.signal.aborted; }
    };
};

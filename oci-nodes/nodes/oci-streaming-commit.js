/* Copyright (c) 2026 Oracle and/or its affiliates. Licensed under the UPL, Version 1.0. */

module.exports = function (RED) {
    var streamingSupport = require("../lib/oci-streaming.js");
    var ociError = require("../lib/oci-error.js");

    function OciStreamingCommitNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.on("input", async function (msg, send, done) {
            try {
                if (
                    !msg.ociStreaming ||
                    typeof msg.ociStreaming !== "object" ||
                    typeof msg.ociStreaming.consumerNodeId !== "string" ||
                    !msg.ociStreaming.consumerNodeId ||
                    typeof msg.ociStreaming.commitToken !== "string" ||
                    !msg.ociStreaming.commitToken ||
                    msg.ociStreaming.autoCommit !== false
                ) {
                    throw streamingSupport.validationError("Manual OCI Streaming commit metadata is required");
                }

                var source = RED.nodes.getNode(msg.ociStreaming.consumerNodeId);
                if (
                    !source ||
                    source.type !== "oci-streaming-in" ||
                    typeof source.commitMessage !== "function"
                ) {
                    throw streamingSupport.validationError("The originating Streaming In node is not active");
                }

                node.status({ fill: "yellow", shape: "dot", text: "committing" });
                var result = await source.commitMessage(msg.ociStreaming.commitToken);
                var outMsg = Object.assign({}, msg, {
                    ociStreaming: Object.assign({}, msg.ociStreaming, result, { committed: true })
                });
                streamingSupport.reattachTransaction(msg, outMsg);
                node.status({ fill: "green", shape: "dot", text: "committed" });
                send(outMsg);
                done();
            } catch (err) {
                var safeError = streamingSupport.redactError(err, [
                    msg.ociStreaming && msg.ociStreaming.commitToken
                ]);
                ociError.handleNodeError(node, msg, safeError, done, {
                    statusText: "commit failed",
                    statusShape: safeError.isValidation ? "ring" : "dot",
                    setPayload: false
                });
            }
        });
    }

    RED.nodes.registerType("oci-streaming-commit", OciStreamingCommitNode);
};

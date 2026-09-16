/* Copyright (c) 2026 Oracle and/or its affiliates. Licensed under the UPL, Version 1.0. */

module.exports = function (RED) {
    var streamingSupport = require("../lib/oci-streaming.js");
    var ociError = require("../lib/oci-error.js");

    function OciStreamingOutNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        node.streamingConfig = RED.nodes.getNode(config.streamingConfig);

        if (!node.streamingConfig) {
            node.status({ fill: "red", shape: "ring", text: "no streaming config" });
            node.error("No OCI Streaming Config configured");
            return;
        }

        node.on("input", async function (msg, send, done) {
            try {
                var input = msg.ociStreaming && typeof msg.ociStreaming === "object" && !Array.isArray(msg.ociStreaming)
                    ? msg.ociStreaming
                    : {};
                var messages = streamingSupport.buildMessages(msg.payload, input);
                var opcRequestId = streamingSupport.getOpcRequestId(input);
                var streamOcid = node.streamingConfig.getStreamOcid();
                var request = {
                    streamId: streamOcid,
                    putMessagesDetails: { messages: messages }
                };
                if (opcRequestId) request.opcRequestId = opcRequestId;

                node.status({ fill: "yellow", shape: "dot", text: "publishing" });
                var client = await node.streamingConfig.getClient();
                var response = await client.putMessages(request);
                var result = response.putMessagesResult || {};
                var responseRequestId = response.opcRequestId || opcRequestId || null;
                var statusCode = response.__httpStatusCode || 200;
                var entries = Array.isArray(result.entries) ? result.entries : [];
                var failedEntries = entries.filter(function (entry) { return Boolean(entry && entry.error); });

                if (failedEntries.length) {
                    msg.statusCode = statusCode;
                    msg.ociStreaming = Object.assign({}, input, {
                        streamOcid: streamOcid,
                        result: result,
                        opcRequestId: responseRequestId
                    });
                    var partialError = new Error(
                        "OCI Streaming failed to publish " + failedEntries.length + " of " + messages.length + " messages"
                    );
                    partialError.code = failedEntries[0].error;
                    partialError.statusCode = statusCode;
                    throw partialError;
                }

                var outMsg = Object.assign({}, msg, {
                    statusCode: statusCode,
                    ociStreaming: Object.assign({}, input, {
                        streamOcid: streamOcid,
                        result: result,
                        opcRequestId: responseRequestId
                    })
                });
                streamingSupport.reattachTransaction(msg, outMsg);

                node.status({
                    fill: "green",
                    shape: "dot",
                    text: "published " + messages.length + (messages.length === 1 ? " message" : " messages")
                });
                send(outMsg);
                done();
            } catch (err) {
                ociError.handleNodeError(node, msg, err, done, {
                    statusText: "publish failed",
                    statusShape: err.isValidation ? "ring" : "dot",
                    setPayload: false
                });
            }
        });
    }

    RED.nodes.registerType("oci-streaming-out", OciStreamingOutNode);
};

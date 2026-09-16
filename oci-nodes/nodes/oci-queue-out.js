/* Copyright (c) 2026 Oracle and/or its affiliates. Licensed under the UPL, Version 1.0. */

module.exports = function (RED) {
    var queueSupport = require("../lib/oci-queue.js");
    var ociError = require("../lib/oci-error.js");

    function OciQueueOutNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        node.queueConfig = RED.nodes.getNode(config.queueConfig);
        if (!node.queueConfig) {
            node.status({ fill: "red", shape: "ring", text: "no Queue config" });
            node.error("No OCI Queue Config configured");
            return;
        }

        node.on("input", async function (msg, send, done) {
            try {
                var input = msg.ociQueue && typeof msg.ociQueue === "object" && !Array.isArray(msg.ociQueue)
                    ? msg.ociQueue
                    : {};
                var messages = queueSupport.buildMessages(msg.payload, input);
                var request = {
                    queueId: node.queueConfig.getQueueOcid(),
                    putMessagesDetails: { messages: messages }
                };
                if (typeof input.opcRequestId === "string" && input.opcRequestId) {
                    request.opcRequestId = input.opcRequestId;
                }

                node.status({ fill: "yellow", shape: "dot", text: "enqueueing" });
                var client = await node.queueConfig.getClient();
                var response = await client.putMessages(request);
                var outMsg = Object.assign({}, msg, {
                    statusCode: response.__httpStatusCode || 200,
                    ociQueue: Object.assign({}, input, {
                        queueOcid: request.queueId,
                        result: response.putMessages || {},
                        opcRequestId: response.opcRequestId || input.opcRequestId || null
                    })
                });
                queueSupport.reattachTransaction(msg, outMsg);
                node.status({ fill: "green", shape: "dot", text: "enqueued " + messages.length });
                send(outMsg);
                done();
            } catch (err) {
                ociError.handleNodeError(node, msg, err, done, {
                    statusText: "enqueue failed",
                    statusShape: err.isValidation ? "ring" : "dot",
                    setPayload: false
                });
            }
        });
    }

    RED.nodes.registerType("oci-queue-out", OciQueueOutNode);
};

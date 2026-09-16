/* Copyright (c) 2026 Oracle and/or its affiliates. Licensed under the UPL, Version 1.0. */

module.exports = function (RED) {
    var kafkaSupport = require("../lib/oci-kafka.js");
    var ociError = require("../lib/oci-error.js");

    function validationError(message) {
        var err = new Error(message);
        err.isValidation = true;
        return err;
    }

    function OciKafkaCommitNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.on("input", async function (msg, send, done) {
            try {
                if (
                    !msg.kafka ||
                    typeof msg.kafka !== "object" ||
                    typeof msg.kafka.consumerNodeId !== "string" ||
                    !msg.kafka.consumerNodeId ||
                    typeof msg.kafka.commitToken !== "string" ||
                    !msg.kafka.commitToken ||
                    msg.kafka.autoCommit !== false
                ) {
                    throw validationError("Manual Kafka commit metadata is required");
                }

                var source = RED.nodes.getNode(msg.kafka.consumerNodeId);
                if (
                    !source ||
                    source.type !== "oci-kafka-consumer" ||
                    typeof source.commitMessage !== "function"
                ) {
                    throw validationError("The originating Kafka Consumer is not active");
                }

                node.status({ fill: "yellow", shape: "dot", text: "committing" });
                var result = await source.commitMessage(msg.kafka.commitToken);
                var outMsg = Object.assign({}, msg, {
                    kafka: Object.assign({}, msg.kafka, result, { committed: true })
                });
                kafkaSupport.reattachTransaction(msg, outMsg);
                node.status({ fill: "green", shape: "dot", text: "committed" });
                send(outMsg);
                done();
            } catch (err) {
                ociError.handleNodeError(node, msg, err, done, {
                    statusText: "commit failed",
                    statusShape: err.isValidation ? "ring" : "dot",
                    setPayload: false
                });
            }
        });
    }

    RED.nodes.registerType("oci-kafka-commit", OciKafkaCommitNode);
};

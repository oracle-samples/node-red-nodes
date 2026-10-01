/*
 Copyright (c) 2026 Oracle and/or its affiliates.
 The Universal Permissive License (UPL), Version 1.0

 Subject to the condition set forth below, permission is hereby granted to any
 person obtaining a copy of this software, associated documentation and/or data
 (collectively the "Software"), free of charge and under any and all copyright
 rights in the Software, and in any and all patent rights owned or freely
 licensable by each licensor hereunder covering either (i) the unmodified
 Software as contributed to or provided by such licensor, or (ii) the Larger
 Works (as defined below), to deal in both

 (a) the Software, and
 (b) any piece of software and/or hardware listed in the lrgrwrks.txt file if
     one is included with the Software (each a "Larger Work" to which the
     Software is contributed by such licensors),

 without restriction, including without limitation the rights to copy, create
 derivative works of, display, perform, and distribute the Software and make,
 use, sell, offer for sale, import, export, have made, and have sold the
 Software and the Larger Work(s), and to sublicense the foregoing rights on
 either these or other terms.

 This license is subject to the following condition: The above copyright notice
 and either this complete permission notice or at a minimum a reference to the
 UPL must be included in all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 SOFTWARE.
 */

module.exports = function (RED) {
    var kafkaSupport = require("../lib/oci-kafka.js");
    var ociError = require("../lib/oci-error.js");

    function OciKafkaProducerNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.kafkaConfig = RED.nodes.getNode(config.kafkaConfig);
        if (!node.kafkaConfig) {
            node.status({ fill: "red", shape: "ring", text: "no Kafka config" });
            node.error("No Kafka Config configured");
            return;
        }
        node.topic = config.topic || "";

        node.on("input", async function (msg, send, done) {
            var validationFailure = false;
            try {
                var kafkaInput = msg.kafka && typeof msg.kafka === "object" && !Array.isArray(msg.kafka)
                    ? msg.kafka
                    : {};
                var topic = typeof kafkaInput.topic === "string" && kafkaInput.topic.trim()
                    ? kafkaInput.topic.trim()
                    : node.topic.trim();
                if (!topic) {
                    validationFailure = true;
                    throw new Error("Kafka topic is required in the node or msg.kafka.topic");
                }

                var message;
                try {
                    message = kafkaSupport.buildMessage(msg.payload, kafkaInput);
                    if (message.headers && Object.prototype.hasOwnProperty.call(message.headers, "__proto__")) {
                        throw new Error("Kafka header __proto__ is not supported because the Kafka client cannot serialize it safely");
                    }
                } catch (err) {
                    validationFailure = true;
                    throw err;
                }

                node.status({ fill: "yellow", shape: "dot", text: "publishing" });
                var producer = await node.kafkaConfig.getProducer();
                var result = await producer.send({
                    topic: topic,
                    messages: [message]
                });
                var outMsg = Object.assign({}, msg, {
                    kafka: Object.assign({}, kafkaInput, {
                        topic: topic,
                        result: result
                    })
                });
                kafkaSupport.reattachTransaction(msg, outMsg);

                node.status({ fill: "green", shape: "dot", text: "published" });
                send(outMsg);
                done();
            } catch (err) {
                validationFailure = validationFailure || Boolean(err && err.isValidation);
                var safeError = typeof node.kafkaConfig.sanitizeError === "function"
                    ? node.kafkaConfig.sanitizeError(err)
                    : err;
                ociError.handleNodeError(node, msg, safeError, done, {
                    statusText: "publish failed",
                    statusShape: validationFailure ? "ring" : "dot",
                    setPayload: false
                });
            }
        });
    }

    RED.nodes.registerType("oci-kafka-producer", OciKafkaProducerNode);
};

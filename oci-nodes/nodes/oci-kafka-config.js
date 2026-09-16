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
    var Kafka = require("@confluentinc/kafka-javascript").KafkaJS.Kafka;
    var kafkaSupport = require("../lib/oci-kafka.js");

    function OciKafkaConfigNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.brokersText = config.brokers || "";
        node.clientId = config.clientId || "node-red-oci-kafka";
        node.username = config.username || "";

        node.sanitizeError = function (err) {
            var values = [
                node.brokersText,
                node.username,
                node.credentials && node.credentials.password
            ].concat(node.brokersText.split(/[\s,]+/));
            return kafkaSupport.redactError(err, values);
        };

        var producer = null;
        var producerPromise = null;

        function validateConfig() {
            var brokers;
            try {
                brokers = kafkaSupport.parseBrokers(node.brokersText);
            } catch (err) {
                err.isValidation = true;
                throw err;
            }
            if (!node.username.trim()) {
                throw configError("SASL Username is required");
            }
            if (!node.credentials || !node.credentials.password) {
                throw configError("SASL Password is required");
            }
            return brokers;
        }

        function configError(message) {
            var err = new Error(message);
            err.isValidation = true;
            return err;
        }

        function createKafka() {
            var brokers = validateConfig();
            return new Kafka({
                kafkaJS: {
                    clientId: node.clientId,
                    brokers: brokers,
                    ssl: true,
                    sasl: {
                        mechanism: "scram-sha-512",
                        username: node.username,
                        password: node.credentials.password
                    }
                }
            });
        }

        async function createProducer() {
            var candidate = createKafka().producer();
            try {
                await candidate.connect();
                producer = candidate;
                return producer;
            } catch (err) {
                try {
                    await candidate.disconnect();
                } catch (disconnectErr) {
                    // The original connection error is the actionable failure.
                }
                throw err;
            }
        }

        node.getProducer = async function () {
            if (producer) return producer;
            if (producerPromise) return producerPromise;

            producerPromise = createProducer();
            try {
                return await producerPromise;
            } finally {
                producerPromise = null;
            }
        };

        node.createConsumer = function (options, rebalanceCallback, batchLimit) {
            var consumerOptions = { kafkaJS: options };
            if (rebalanceCallback) consumerOptions.rebalance_cb = rebalanceCallback;
            if (batchLimit !== undefined) consumerOptions["js.consumer.max.batch.size"] = batchLimit;
            return createKafka().consumer(consumerOptions);
        };

        node.closeProducer = async function () {
            if (producerPromise) {
                try {
                    await producerPromise;
                } catch (err) {
                    return;
                }
            }
            if (!producer) return;

            var current = producer;
            producer = null;
            await current.disconnect();
        };

        node.on("close", async function (removed, done) {
            try {
                await node.closeProducer();
                done();
            } catch (err) {
                done(err);
            }
        });
    }

    RED.nodes.registerType("oci-kafka-config", OciKafkaConfigNode, {
        credentials: {
            password: { type: "password" }
        }
    });

    RED.httpAdmin.post(
        "/oci-kafka-config/:id/test",
        RED.auth.needsPermission("oci-kafka-config.write"),
        async function (req, res) {
            var node = RED.nodes.getNode(req.params.id);
            if (!node) {
                return res.status(404).json({
                    success: false,
                    message: "Node not found. Deploy the flow first, then test."
                });
            }
            try {
                await node.getProducer();
                res.json({ success: true, message: "Connected to Kafka" });
            } catch (err) {
                res.json({ success: false, message: "Kafka connection failed" });
            }
        }
    );
};

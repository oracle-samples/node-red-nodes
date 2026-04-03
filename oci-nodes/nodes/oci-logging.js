/*
 Copyright (c) 2025 Oracle and/or its affiliates.
 The Universal Permissive License (UPL), Version 1.0

 Subject to the condition set forth below, permission is hereby granted to any
 person obtaining a copy of this software, associated documentation and/or data
 (collectively the "Software"), free of charge and under any and all copyright
 rights in the Software, and any and all patent rights owned or freely
 licensable by each licensor hereunder covering either (i) the unmodified
 Software as contributed to or provided by such licensor, or (ii) the Larger
 Works (as defined below), to deal in both

 (a) the Software, and
 (b) any piece of software and/or hardware listed in the
     lrgrwrks.txt file if one is included with the Software (each a "Larger
     Work" to which the Software is contributed by such licensors),

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
    const loggingingestion = require("oci-loggingingestion");
    const { randomUUID } = require("crypto");
    const MAX_LOG_ENTRY_BYTES = (1024 * 1024) - 1; // LogEntry.data should be < 1 MB

    function OciLoggingNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.ociConfig = RED.nodes.getNode(config.ociConfig);
        if (!node.ociConfig) {
            node.status({ fill: "red", shape: "ring", text: "no OCI config" });
            node.error("No OCI Config configured");
            return;
        }

        node.logId = config.logId || "";
        node.logSource = config.logSource || "node-red";
        node.logType = config.logType || "application.events";
        node.severity = config.severity || "INFO";
        node.payloadSource = config.payloadSource || "mappings";

        var mappings = [];
        try { mappings = JSON.parse(config.mappings || "[]"); } catch (e) { mappings = []; }
        if (!Array.isArray(mappings)) mappings = [];

        let client = null;

        async function getClient() {
            if (client) return client;
            const provider = await node.ociConfig.getAuthProvider();
            client = new loggingingestion.LoggingClient({
                authenticationDetailsProvider: provider
            });
            const region = node.ociConfig.getRegion();
            if (region) {
                client.regionId = region;
            }
            return client;
        }

        function resolvePayload(mappings, msg) {
            var payload = {};
            for (var i = 0; i < mappings.length; i++) {
                var m = mappings[i];
                if (!m.logField) continue;
                var val;
                if (m.sourceType === "dequeued") {
                    val = RED.util.getMessageProperty(msg, "dequeued." + (m.value || ""));
                } else if (m.sourceType === "msg") {
                    val = RED.util.getMessageProperty(msg, m.value || "");
                } else {
                    val = m.value || "";
                }
                payload[m.logField] = val;
            }
            return payload;
        }

        node.on("input", async function (msg, send, done) {
            try {
                node.status({ fill: "yellow", shape: "dot", text: "ingesting" });

                const logId = node.logId || msg.logId;
                if (!logId) {
                    const err = new Error("No Log OCID configured or provided in msg.logId");
                    node.status({ fill: "red", shape: "ring", text: "no log OCID" });
                    node.error(err.message, msg);
                    return done(err);
                }

                const logSource = msg.logSource || node.logSource || "node-red";
                const logType = msg.logType || node.logType || "application.events";
                const logSubject = msg.logSubject || "";
                const severity = msg.severity || node.severity || "INFO";

                var logData;
                if (node.payloadSource === "payload") {
                    logData = msg.payload;
                } else {
                    logData = resolvePayload(mappings, msg);
                }

                // Normalize object payloads with timestamp/level.
                if (typeof logData === "object" && logData !== null && !Array.isArray(logData)) {
                    if (!logData.timestamp) {
                        logData.timestamp = new Date().toISOString();
                    }
                    if (!logData.level) {
                        logData.level = severity;
                    }
                    logData = JSON.stringify(logData);
                } else {
                    logData = String(logData);
                }

                const logDataBytes = Buffer.byteLength(logData, "utf8");
                if (logDataBytes > MAX_LOG_ENTRY_BYTES) {
                    const err = new Error(
                        "Log entry data exceeds 1 MB limit (" + logDataBytes + " bytes). " +
                        "Reduce payload size before sending to OCI Logging."
                    );
                    node.status({ fill: "red", shape: "ring", text: "payload too large" });
                    node.error(err.message, msg);
                    return done(err);
                }

                const now = new Date();

                const logEntryBatch = {
                    source: logSource,
                    type: logType,
                    defaultlogentrytime: now,
                    entries: [
                        {
                            id: randomUUID(),
                            data: logData,
                            time: now
                        }
                    ]
                };

                if (logSubject) {
                    logEntryBatch.subject = logSubject;
                }

                const putLogsDetails = {
                    specversion: "1.0",
                    logEntryBatches: [logEntryBatch]
                };

                const logClient = await getClient();

                const response = await logClient.putLogs({
                    logId: logId,
                    putLogsDetails: putLogsDetails
                });

                msg.payload = {
                    opcRequestId: response.opcRequestId || null,
                    statusCode: response.__httpStatusCode || 200
                };
                msg.statusCode = response.__httpStatusCode || 200;

                node.status({ fill: "green", shape: "dot", text: "ingested" });
                send(msg);
                done();

                setTimeout(function () {
                    node.status({});
                }, 3000);

            } catch (err) {
                node.status({ fill: "red", shape: "dot", text: "failed" });
                msg.error = err.message || err.toString();
                msg.statusCode = err.statusCode || 0;
                msg.payload = err.message;
                node.error(msg.error, msg);
                done(err);
            }
        });
    }

    RED.nodes.registerType("oci-logging", OciLoggingNode);
};

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
    const loganalytics = require("oci-loganalytics");
    const { Readable } = require("stream");
    const MAX_LOG_ENTRY_BYTES = (1024 * 1024) - 1; // Guard oversized log records

    function OciLogAnalyticsNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.ociConfig = RED.nodes.getNode(config.ociConfig);
        if (!node.ociConfig) {
            node.status({ fill: "red", shape: "ring", text: "no OCI config" });
            node.error("No OCI Config configured");
            return;
        }

        node.namespace = config.namespace || "";
        node.logGroupOcid = config.logGroupOcid || "";
        node.logSourceName = config.logSourceName || "";
        node.entityOcid = config.entityOcid || "";
        node.severity = config.severity || "INFO";
        node.payloadSource = config.payloadSource || "mappings";

        // Parse mappings
        var mappings = [];
        try { mappings = JSON.parse(config.mappings || "[]"); } catch (e) { mappings = []; }
        if (!Array.isArray(mappings)) mappings = [];

        let client = null;

        async function getClient() {
            if (client) return client;
            const provider = await node.ociConfig.getAuthProvider();
            client = new loganalytics.LogAnalyticsClient({
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
                node.status({ fill: "yellow", shape: "dot", text: "uploading" });

                const namespace = node.namespace || msg.namespace;
                if (!namespace) {
                    const err = new Error("No namespace configured or provided in msg.namespace");
                    node.status({ fill: "red", shape: "ring", text: "no namespace" });
                    node.error(err.message, msg);
                    return done(err);
                }

                const logGroupId = node.logGroupOcid || msg.logGroupOcid;
                if (!logGroupId) {
                    const err = new Error("No Log Group OCID configured or provided in msg.logGroupOcid");
                    node.status({ fill: "red", shape: "ring", text: "no log group" });
                    node.error(err.message, msg);
                    return done(err);
                }

                const logSourceName = node.logSourceName || msg.logSourceName;
                if (!logSourceName) {
                    const err = new Error("No Log Source Name configured or provided in msg.logSourceName");
                    node.status({ fill: "red", shape: "ring", text: "no log source" });
                    node.error(err.message, msg);
                    return done(err);
                }

                const entityId = node.entityOcid || msg.entityOcid || "";
                const severity = msg.severity || node.severity || "INFO";

                // Build the log payload from either mappings or msg.payload
                var logPayload;
                if (node.payloadSource === "payload") {
                    logPayload = msg.payload;
                } else {
                    logPayload = resolvePayload(mappings, msg);
                }

                // Ensure it's an object so we can add timestamp/level
                if (typeof logPayload === "object" && logPayload !== null && !Array.isArray(logPayload)) {
                    if (!logPayload.timestamp) {
                        logPayload.timestamp = new Date().toISOString();
                    }
                    if (!logPayload.level) {
                        logPayload.level = severity;
                    }
                    logPayload = JSON.stringify(logPayload);
                } else {
                    logPayload = String(logPayload);
                }

                const logPayloadBytes = Buffer.byteLength(logPayload, "utf8");
                if (logPayloadBytes > MAX_LOG_ENTRY_BYTES) {
                    const err = new Error(
                        "Log payload exceeds 1 MB safety limit (" + logPayloadBytes + " bytes). " +
                        "Reduce payload size before sending to Log Analytics."
                    );
                    node.status({ fill: "red", shape: "ring", text: "payload too large" });
                    node.error(err.message, msg);
                    return done(err);
                }

                var logEvent = {
                    logSourceName: logSourceName,
                    logRecords: [logPayload]
                };

                if (entityId) {
                    logEvent.entityId = entityId;
                }

                if (msg.logMetadata && typeof msg.logMetadata === "object") {
                    logEvent.metadata = msg.logMetadata;
                }

                var uploadBody = {
                    logEvents: [logEvent]
                };

                if (msg.globalMetadata && typeof msg.globalMetadata === "object") {
                    uploadBody.metadata = msg.globalMetadata;
                }

                const laClient = await getClient();

                var bodyString = JSON.stringify(uploadBody);
                var bodyBuffer = Buffer.from(bodyString, "utf-8");

                const response = await laClient.uploadLogEventsFile({
                    namespaceName: namespace,
                    logGroupId: logGroupId,
                    uploadLogEventsFileDetails: bodyBuffer,
                    payloadType: "JSON",
                    contentType: "application/octet-stream"
                });

                msg.payload = {
                    statusCode: response.__httpStatusCode || 200,
                    requestId: response.opcRequestId || null
                };
                msg.statusCode = response.__httpStatusCode || 200;

                node.status({ fill: "green", shape: "dot", text: "uploaded" });
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

    RED.nodes.registerType("oci-log-analytics", OciLogAnalyticsNode);
};

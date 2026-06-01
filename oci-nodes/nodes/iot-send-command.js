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
    const iot = require("oci-iot");
    const ociError = require("../lib/oci-error.js");
    const ISO_8601_DURATION_REGEX = /^P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/;

    function normalizeEndpoint(value) {
        return String(value || "").trim();
    }

    function normalizeDuration(value, fieldName) {
        const normalized = String(value || "").trim().toUpperCase();
        if (!ISO_8601_DURATION_REGEX.test(normalized)) {
            throw new Error(fieldName + " must be a valid ISO 8601 duration (e.g. PT10M, PT1H, P1D)");
        }
        return normalized;
    }

    function parseRecordIdFromLocation(value) {
        const location = String(value || "").trim();
        if (!location) {
            return "";
        }

        let pathname;
        try {
            pathname = new URL(location, "https://example.invalid").pathname;
        } catch (err) {
            pathname = location.split("?")[0];
        }

        const pathParts = String(pathname || "").split("/").filter(Boolean);
        const encodedRecordId = pathParts[pathParts.length - 1] || "";
        if (!encodedRecordId) {
            return "";
        }

        try {
            return decodeURIComponent(encodedRecordId);
        } catch (err) {
            return encodedRecordId;
        }
    }

    function IotSendCommandNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.ociConfig = RED.nodes.getNode(config.ociConfig);
        if (!node.ociConfig) {
            node.status({ fill: "red", shape: "ring", text: "no OCI config" });
            node.error("No OCI Config configured");
            return;
        }

        node.digitalTwinOcid = config.digitalTwinOcid || "";
        node.requestEndpoint = normalizeEndpoint(config.requestEndpoint);
        node.responseEndpoint = normalizeEndpoint(config.responseEndpoint);
        node.requestDuration = config.requestDuration || "PT10M";
        node.responseDuration = config.responseDuration || "PT10M";
        node.waitForResponse = config.waitForResponse !== false;

        let client = null;

        async function getClient() {
            if (client) return client;
            const provider = await node.ociConfig.getAuthProvider();
            client = new iot.IotClient({
                authenticationDetailsProvider: provider
            });
            const region = node.ociConfig.getRegion();
            if (region) {
                client.regionId = region;
            }
            return client;
        }

        node.on("input", async function (msg, send, done) {
            try {
                node.status({ fill: "yellow", shape: "dot", text: "sending command" });

                const digitalTwinId = node.digitalTwinOcid || msg.digitalTwinOcid;
                if (!digitalTwinId) {
                    const err = new Error("No Digital Twin Instance OCID configured or provided in msg.digitalTwinOcid");
                    node.status({ fill: "red", shape: "ring", text: "no twin OCID" });
                    msg.error = { message: err.message, code: null };
                    msg.statusCode = 0;
                    msg.payload = err.message;
                    node.error(err.message, msg);
                    return done(err);
                }

                const requestEndpoint = normalizeEndpoint(resolveMessageOverride(msg, "requestEndpoint", node.requestEndpoint));
                if (!requestEndpoint) {
                    const err = new Error("Request Endpoint is required");
                    node.status({ fill: "red", shape: "ring", text: "no request endpoint" });
                    msg.error = { message: err.message, code: null };
                    msg.statusCode = 0;
                    msg.payload = err.message;
                    node.error(err.message, msg);
                    return done(err);
                }
                const requestDuration = normalizeDuration(node.requestDuration, "Request Duration");
                let responseDuration;
                let responseEndpoint = "";

                var requestData = msg.payload;
                if (typeof requestData !== "object" || requestData === null) {
                    requestData = { value: requestData };
                }

                const iotClient = await getClient();

                // Build command request payload.
                var invokeRawCommandDetails = {
                    requestDataFormat: "JSON",
                    requestEndpoint: requestEndpoint,
                    requestData: requestData,
                    requestDuration: requestDuration
                };

                if (node.waitForResponse) {
                    responseEndpoint = normalizeEndpoint(resolveMessageOverride(msg, "responseEndpoint", node.responseEndpoint));
                    if (!responseEndpoint) {
                        const err = new Error("Response Endpoint is required when Wait for Response is enabled");
                        node.status({ fill: "red", shape: "ring", text: "no response endpoint" });
                        msg.error = { message: err.message, code: null };
                        msg.statusCode = 0;
                        msg.payload = err.message;
                        node.error(err.message, msg);
                        return done(err);
                    }
                    responseDuration = normalizeDuration(node.responseDuration, "Response Duration");
                    invokeRawCommandDetails.responseEndpoint = responseEndpoint;
                    invokeRawCommandDetails.responseDuration = responseDuration;
                }

                const response = await iotClient.invokeRawCommand({
                    digitalTwinInstanceId: digitalTwinId,
                    invokeRawCommandDetails: invokeRawCommandDetails
                });

                msg.payload = response.rawCommandResponse || response;
                msg.statusCode = response.__httpStatusCode || 200;
                msg.requestEndpoint = requestEndpoint;
                if (response.location) {
                    msg.commandStatusLocation = response.location;
                    var recordId = parseRecordIdFromLocation(response.location);
                    if (recordId) {
                        msg.recordId = recordId;
                        msg.rawCommandDataRecordId = recordId;
                    }
                }
                if (response.opcRequestId) {
                    msg.opcRequestId = response.opcRequestId;
                }
                if (node.waitForResponse) {
                    msg.responseEndpoint = responseEndpoint;
                } else {
                    delete msg.responseEndpoint;
                }

                node.status({ fill: "green", shape: "dot", text: "sent" });
                send(msg);
                done();

                setTimeout(function () {
                    node.status({});
                }, 3000);

            } catch (err) {
                ociError.handleNodeError(node, msg, err, done, { statusText: "send failed" });
            }
        });
    }

    function resolveMessageOverride(msg, propertyName, configuredValue) {
        if (Object.prototype.hasOwnProperty.call(msg, propertyName)) {
            return msg[propertyName];
        }
        return configuredValue;
    }

    RED.nodes.registerType("iot-send-command", IotSendCommandNode);
};

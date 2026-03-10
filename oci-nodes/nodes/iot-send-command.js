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
        node.baseEndpoint = (config.baseEndpoint || "iot/v1").replace(/\/+$/, "");
        node.commandKey = config.commandKey || "";
        node.requestDuration = config.requestDuration || "PT10M";
        node.responseDuration = config.responseDuration || "PT10M";
        node.waitForResponse = config.waitForResponse !== false;

        let client = null;

        function getClient() {
            if (client) return client;
            const provider = node.ociConfig.getAuthProvider();
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
                    node.error(err.message, msg);
                    return done(err);
                }

                const cmdKey = node.commandKey || msg.commandKey || "default";
                const requestEndpoint = node.baseEndpoint + "/cmd/" + cmdKey;
                const responseEndpoint = node.baseEndpoint + "/rsp/" + cmdKey;

                var requestData = msg.payload;
                if (typeof requestData !== "object" || requestData === null) {
                    requestData = { value: requestData };
                }

                const iotClient = getClient();

                // Build the invokeRawCommand details with JSON format discriminator
                var invokeRawCommandDetails = {
                    requestDataFormat: "JSON",
                    requestEndpoint: requestEndpoint,
                    requestData: requestData,
                    requestDuration: node.requestDuration
                };

                if (node.waitForResponse) {
                    invokeRawCommandDetails.responseEndpoint = responseEndpoint;
                    invokeRawCommandDetails.responseDuration = node.responseDuration;
                }

                const response = await iotClient.invokeRawCommand({
                    digitalTwinInstanceId: digitalTwinId,
                    invokeRawCommandDetails: invokeRawCommandDetails
                });

                msg.payload = response.rawCommandResponse || response;
                msg.statusCode = response.__httpStatusCode || 200;
                msg.commandKey = cmdKey;
                msg.requestEndpoint = requestEndpoint;
                msg.responseEndpoint = responseEndpoint;

                node.status({ fill: "green", shape: "dot", text: "sent: " + cmdKey });
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
                send(msg);
                done(err);
            }
        });
    }

    RED.nodes.registerType("iot-send-command", IotSendCommandNode);
};
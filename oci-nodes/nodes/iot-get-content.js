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

    function normalizeBoolean(value, fallbackValue, fieldName) {
        if (value === undefined || value === null || value === "") {
            return fallbackValue;
        }

        if (typeof value === "boolean") {
            return value;
        }

        var normalized = String(value).trim().toLowerCase();
        if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "y" || normalized === "on") {
            return true;
        }
        if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "n" || normalized === "off") {
            return false;
        }

        throw new Error("Invalid " + fieldName + " value. Use true or false.");
    }

    function IotGetContentNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.ociConfig = RED.nodes.getNode(config.ociConfig);
        if (!node.ociConfig) {
            node.status({ fill: "red", shape: "ring", text: "no OCI config" });
            node.error("No OCI Config configured");
            return;
        }

        node.digitalTwinOcid = String(config.digitalTwinOcid || "").trim();
        node.shouldIncludeMetadata = normalizeBoolean(config.shouldIncludeMetadata, false, "shouldIncludeMetadata");

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
            const digitalTwinId = String((msg.digitalTwinOcid !== undefined && msg.digitalTwinOcid !== null) ? msg.digitalTwinOcid : node.digitalTwinOcid || "").trim();
            if (!digitalTwinId) {
                const err = new Error("No Digital Twin Instance OCID configured or provided in msg.digitalTwinOcid");
                node.status({ fill: "red", shape: "ring", text: "no twin OCID" });
                node.error(err.message, msg);
                return done(err);
            }

            let shouldIncludeMetadata;
            try {
                shouldIncludeMetadata = normalizeBoolean(
                    msg.shouldIncludeMetadata,
                    node.shouldIncludeMetadata,
                    "shouldIncludeMetadata"
                );
            } catch (validationErr) {
                node.status({ fill: "red", shape: "ring", text: "invalid metadata flag" });
                node.error(validationErr.message, msg);
                return done(validationErr);
            }

            try {
                node.status({ fill: "yellow", shape: "dot", text: "fetching content" });

                const iotClient = await getClient();
                const response = await iotClient.getDigitalTwinInstanceContent({
                    digitalTwinInstanceId: digitalTwinId,
                    shouldIncludeMetadata: shouldIncludeMetadata
                });

                node.status({ fill: "green", shape: "dot", text: "content fetched" });

                var outMsg = Object.assign({}, msg, {
                    payload: (response && response.value !== undefined) ? response.value : response,
                    statusCode: (response && response.__httpStatusCode) ? response.__httpStatusCode : 200,
                    etag: (response && response.etag) ? response.etag : null,
                    opcRequestId: (response && response.opcRequestId) ? response.opcRequestId : null,
                    digitalTwinOcid: digitalTwinId,
                    shouldIncludeMetadata: shouldIncludeMetadata
                });

                send(outMsg);
                done();

                setTimeout(function () {
                    node.status({});
                }, 3000);
            } catch (err) {
                ociError.handleNodeError(node, msg, err, done, { statusText: "get content failed" });
            }
        });
    }

    RED.nodes.registerType("iot-get-content", IotGetContentNode);
};

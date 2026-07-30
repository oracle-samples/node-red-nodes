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

module.exports = function(RED) {
    const axios = require("axios");
    const { HttpsProxyAgent } = require("https-proxy-agent");
    const scmMapping = require("../lib/scm-mapping.js");
    const scmError = require("../lib/scm-error.js");
    const fusionRequestValidation = require("../lib/fusion-request-validation.js");

    const ENDPOINT_MAP = {
        createAsset: "installedBaseAssets",
        createMeterReading: "meterReadings",
        subinventoryQuantityTransfer: "inventoryStagedTransactions",
        miscTransaction: "inventoryStagedTransactions"
    };
    function FusionRequestNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.server = RED.nodes.getNode(config.server);
        if (!node.server) {
            node.status({ fill: "red", shape: "ring", text: "no SCM server" });
            node.error("No SCM Server configured");
            return;
        }

        const proxyAgent = (node.server.proxyUrl && node.server.useProxy)
            ? new HttpsProxyAgent(node.server.proxyUrl) : null;

        const mappings = scmMapping.parseMappings(config.mappings);

        node.on("input", async (msg, send, done) => {
            try {
                const txType = config.transactionType || "custom";
                const method = msg.method || config.method || "POST";

                let url;
                if (txType === "custom") {
                    url = config.customPath || "";
                } else {
                    url = node.server.buildUrl(ENDPOINT_MAP[txType] || "");
                }
                if (!url) {
                    const err = fusionRequestValidation.createValidationError("No URL configured");
                    err.fusionRequestStatusText = "no custom URL";
                    throw err;
                }

                const normalizedMethod = String(method).trim().toUpperCase();
                const payload = scmMapping.resolveRequestPayload(
                    config.payloadSource,
                    mappings,
                    msg,
                    RED,
                    {
                        allowEmptyMappedPayload:
                            normalizedMethod !== "POST" &&
                            normalizedMethod !== "PUT" &&
                            normalizedMethod !== "PATCH"
                    }
                );
                const request = fusionRequestValidation.validateFusionRequest({
                    url: url,
                    allowedHostname: node.server.hostname,
                    apiVersion: node.server.version,
                    custom: txType === "custom",
                    method: method,
                    requestMediaType: config.requestMediaType,
                    payload: payload
                });

                node.status({ fill: "yellow", shape: "dot", text: "retrieving token..." });
                const token = await node.server.getToken();

                node.status({ fill: "yellow", shape: "dot", text: "requesting..." });
                const response = await axios({
                    method: request.method.toLowerCase(),
                    url: request.url,
                    timeout: 30000,
                    data: (request.method !== "GET" && request.method !== "DELETE")
                        ? request.payload
                        : undefined,
                    params: request.method === "GET" ? request.payload : undefined,
                    httpsAgent: proxyAgent || undefined,
                    proxy: false,
                    maxRedirects: txType === "custom" ? 0 : undefined,
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "Content-Type": request.contentType
                    }
                });

                msg.statusCode = response.status;
                msg.payload = response.data;
                node.status({
                    fill: "green",
                    shape: "dot",
                    text: successStatusText(request.method)
                });
                send(msg);
                done();
            } catch (err) {
                const validationError = err && (
                    err.fusionRequestValidationError || err.scmPayloadValidationError
                );
                scmError.handleNodeError(node, msg, err, done, {
                    statusText: validationError
                        ? (err.fusionRequestStatusText || (err.scmPayloadValidationError ? "invalid payload" : "invalid request"))
                        : "request failed",
                    statusShape: validationError ? "ring" : "dot"
                });
            }
        });
    }

    RED.nodes.registerType("fusion-request", FusionRequestNode);

    function successStatusText(method) {
        switch (method) {
            case "GET": return "read";
            case "POST": return "submitted";
            case "PUT":
            case "PATCH": return "updated";
            case "DELETE": return "deleted";
        }
        return "sent";
    }
};

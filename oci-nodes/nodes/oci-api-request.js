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
    var apiRequest = require("../lib/oci-api-request.js");
    var ociError = require("../lib/oci-error.js");

    function preserveTransaction(outMsg, msg) {
        if (msg.transaction) {
            Object.defineProperty(outMsg, "transaction", {
                value: msg.transaction,
                enumerable: false,
                writable: true,
                configurable: true
            });
        }
    }

    function successStatus(method) {
        switch (method) {
            case "GET":
            case "HEAD":
                return "read";
            case "POST":
                return "submitted";
            case "PUT":
            case "PATCH":
                return "updated";
            case "DELETE":
                return "deleted";
            default:
                return "completed";
        }
    }

    function OciApiRequestNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.ociConfig = RED.nodes.getNode(config.ociConfig);
        if (!node.ociConfig) {
            node.status({ fill: "red", shape: "ring", text: "no OCI config" });
            node.error("No OCI Config configured");
            return;
        }

        node.endpoint = config.endpoint || "";
        node.method = config.method || "GET";
        node.path = config.path || "";
        node.query = config.query || "{}";
        node.headers = config.headers || "{}";
        node.responseType = config.responseType || "auto";
        node.timeoutMs = Number(config.timeoutMs || 30000);

        node.on("input", async function (msg, send, done) {
            try {
                var prepared = apiRequest.prepareRequest({
                    endpoint: node.endpoint,
                    method: msg.method || node.method,
                    path: msg.ociPath === undefined ? node.path : msg.ociPath,
                    query: node.query,
                    runtimeQuery: msg.ociQuery,
                    headers: node.headers,
                    runtimeHeaders: msg.ociHeaders,
                    responseType: node.responseType,
                    timeoutMs: node.timeoutMs,
                    payload: msg.payload
                });

                node.status({ fill: "yellow", shape: "dot", text: "requesting" });
                var provider = await node.ociConfig.getAuthProvider();
                var response = await apiRequest.executeSignedRequest(provider, prepared);
                var responseHeaders = response.responseHeaders;
                var outMsg = Object.assign({}, msg, {
                    payload: response.payload,
                    statusCode: response.statusCode,
                    responseHeaders: responseHeaders,
                    opcRequestId: responseHeaders["opc-request-id"] || null,
                    opcWorkRequestId: responseHeaders["opc-work-request-id"] || null,
                    nextPage: responseHeaders["opc-next-page"] || null,
                    ociUrl: response.url,
                    ociMethod: response.method
                });
                preserveTransaction(outMsg, msg);

                node.status({ fill: "green", shape: "dot", text: successStatus(response.method) });
                send(outMsg);
                done();
            } catch (err) {
                ociError.handleNodeError(node, msg, err, done, {
                    statusShape: err.isValidationError ? "ring" : "dot",
                    statusText: err.isValidationError ? "invalid request" : "request failed"
                });
            }
        });
    }

    RED.nodes.registerType("oci-api-request", OciApiRequestNode);
};

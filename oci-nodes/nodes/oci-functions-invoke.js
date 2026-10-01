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
    var functions = require("oci-functions");
    var functionsSupport = require("../lib/oci-functions.js");
    var ociError = require("../lib/oci-error.js");
    var responseSupport = require("../lib/oci-response.js");

    function OciFunctionsInvokeNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.ociConfig = RED.nodes.getNode(config.ociConfig);
        if (!node.ociConfig) {
            node.status({ fill: "red", shape: "ring", text: "no OCI config" });
            node.error("No OCI Config configured");
            return;
        }

        node.functionOcid = config.functionOcid || "";
        node.invokeEndpoint = config.invokeEndpoint || "";
        node.invokeType = config.invokeType || "sync";
        node.intent = config.intent || "httprequest";
        node.maxResponseBytes = config.maxResponseBytes;

        var clientManager = require("../lib/oci-client.js")(node);

        function getClient(endpoint, cached) {
            async function factory() {
                var provider = await node.ociConfig.getAuthProvider();
                return new functions.FunctionsInvokeClient({ authenticationDetailsProvider: provider });
            }
            function configure(client) {
                client.endpoint = endpoint;
            }
            return cached ? clientManager.get(endpoint, factory, configure) : clientManager.create(factory, configure);
        }

        node.on("input", async function (msg, send, done) {
            var validationFailure = false;
            try {
                var input = msg.ociFunction && typeof msg.ociFunction === "object" && !Array.isArray(msg.ociFunction)
                    ? msg.ociFunction
                    : {};
                var functionOcid = input.functionOcid || node.functionOcid;
                if (typeof functionOcid !== "string" || !functionOcid.trim()) {
                    validationFailure = true;
                    throw new Error("Function OCID is required in the node or msg.ociFunction.functionOcid");
                }

                var endpoint;
                var invokeType = input.invokeType || node.invokeType;
                var intent = input.intent || node.intent;
                var limit;
                try {
                    limit = responseSupport.responseLimit(node.maxResponseBytes);
                    endpoint = functionsSupport.validateEndpoint(input.invokeEndpoint || node.invokeEndpoint);
                    if (["sync", "detached"].indexOf(invokeType) === -1) {
                        throw new Error("Invoke Type must be sync or detached");
                    }
                    if (["httprequest", "cloudevent"].indexOf(intent) === -1) {
                        throw new Error("Intent must be httprequest or cloudevent");
                    }
                    if (input.isDryRun !== undefined && typeof input.isDryRun !== "boolean") {
                        throw new Error("msg.ociFunction.isDryRun must be a boolean");
                    }
                } catch (err) {
                    validationFailure = true;
                    throw err;
                }

                var request = {
                    functionId: functionOcid.trim(),
                    invokeFunctionBody: functionsSupport.serializeBody(msg.payload),
                    fnInvokeType: invokeType,
                    fnIntent: intent
                };
                if (typeof input.opcRequestId === "string" && input.opcRequestId) {
                    request.opcRequestId = input.opcRequestId;
                }
                if (input.isDryRun !== undefined) {
                    request.isDryRun = input.isDryRun;
                }

                node.status({ fill: "yellow", shape: "dot", text: "invoking" });
                var configuredEndpoint = null;
                try {
                    configuredEndpoint = functionsSupport.validateEndpoint(node.invokeEndpoint);
                } catch (err) {
                    configuredEndpoint = null;
                }
                var cacheClient = endpoint === configuredEndpoint;
                var client = await getClient(endpoint, cacheClient);
                var response;
                var responsePayload;
                try {
                    response = await client.invokeFunction(request);
                    responsePayload = await functionsSupport.readResponse(response.value, limit, response.contentLength);
                } finally {
                    if (!cacheClient) clientManager.release(client);
                }
                var outMsg = Object.assign({}, msg, {
                    payload: responsePayload,
                    statusCode: response.__httpStatusCode || (invokeType === "detached" ? 202 : 200),
                    ociFunction: Object.assign({}, input, {
                        functionOcid: functionOcid.trim(),
                        invokeEndpoint: endpoint,
                        invokeType: invokeType,
                        intent: intent,
                        opcRequestId: response.opcRequestId || input.opcRequestId || null
                    })
                });
                functionsSupport.reattachTransaction(msg, outMsg);

                node.status({ fill: "green", shape: "dot", text: invokeType === "detached" ? "accepted" : "invoked" });
                clientManager.assertOpen();
                send(outMsg);
                done();
            } catch (err) {
                if (/msg\.payload/.test(err.message)) validationFailure = true;
                ociError.handleNodeError(node, msg, err, done, {
                    statusText: "invoke failed",
                    statusShape: validationFailure ? "ring" : "dot",
                    setPayload: false
                });
            }
        });


    }

    RED.nodes.registerType("oci-functions-invoke", OciFunctionsInvokeNode);
};

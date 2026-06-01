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
    var axios = require("axios");
    var HttpsProxyAgent = require("https-proxy-agent").HttpsProxyAgent;
    var ensureHttps = require("../lib/url.js").ensureHttps;
    var scmMapping = require("../lib/scm-mapping.js");
    var scmError = require("../lib/scm-error.js");

    function ManufacturingWorkOrderNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.server = RED.nodes.getNode(config.server);
        if (!node.server) {
            node.status({ fill: "red", shape: "ring", text: "no SCM server" });
            node.error("No SCM Server configured");
            return;
        }

        var mappings = scmMapping.parseMappings(config.mappings);
        var proxyAgent = buildProxyAgent(node.server);

        node.on("input", async function(msg, send, done) {
            try {
                var action = resolveAction(config, msg);
                var payload = scmMapping.resolvePayload(mappings, msg, RED);
                var workOrdersUrl = node.server.buildUrl("workOrders");
                var url = resolveRequestUrl(workOrdersUrl, action, config, msg);
                ensureHttps(url);

                node.status({ fill: "yellow", shape: "dot", text: "retrieving token..." });
                var token = await node.server.getToken();

                node.status({ fill: "yellow", shape: "dot", text: action === "create" ? "creating..." : "updating..." });
                var response = await sendRequest(action, url, payload, token, proxyAgent);
                var outMsg = Object.assign({}, msg, {
                    payload: response.data,
                    statusCode: response.status,
                    manufacturingWorkOrder: response.data
                });
                reattachTransaction(msg, outMsg);

                node.status({ fill: "green", shape: "dot", text: action === "create" ? "created" : "updated" });
                send(outMsg);
                done();
            } catch (err) {
                var validationError = err && err.manufacturingWorkOrderValidationError;
                node.status({
                    fill: "red",
                    shape: validationError ? "ring" : "dot",
                    text: validationError ? "invalid input" : "request failed"
                });
                scmError.handleNodeError(node, msg, err, done, {
                    statusText: validationError ? "invalid input" : "request failed",
                    statusShape: validationError ? "ring" : "dot"
                });
            }
        });
    }

    function resolveAction(config, msg) {
        var action = String(msg.action || config.action || "create").trim().toLowerCase();
        if (action !== "create" && action !== "update") {
            throwValidationError("Manufacturing Work Order action must be create or update");
        }
        return action;
    }

    function resolveRequestUrl(workOrdersUrl, action, config, msg) {
        if (action === "create") {
            return workOrdersUrl;
        }
        var workOrderIdRaw = msg.workOrderId || config.workOrderId;
        var workOrderId = workOrderIdRaw == null ? "" : String(workOrderIdRaw).trim();
        if (!workOrderId) {
            throwValidationError("Work Order ID is required for update");
        }
        return appendResourceId(workOrdersUrl, workOrderId);
    }

    function appendResourceId(baseUrl, resourceId) {
        var parsedUrl = ensureHttps(baseUrl);
        var basePath = parsedUrl.pathname.endsWith("/") && parsedUrl.pathname.length > 1
            ? parsedUrl.pathname.slice(0, -1)
            : parsedUrl.pathname;
        parsedUrl.pathname = basePath + "/" + encodeURIComponent(resourceId);
        return parsedUrl.toString();
    }

    async function sendRequest(action, url, payload, token, proxyAgent) {
        var options = {
            timeout: 30000,
            httpsAgent: proxyAgent || undefined,
            proxy: false,
            headers: {
                "Authorization": "Bearer " + token,
                "Content-Type": "application/vnd.oracle.adf.resourceitem+json"
            }
        };

        if (action === "create") {
            return axios.post(url, payload, options);
        }
        return axios.patch(url, payload, options);
    }

    function buildProxyAgent(server) {
        if (server.proxyUrl && server.useProxy) {
            return new HttpsProxyAgent(server.proxyUrl);
        }
        return null;
    }

    function throwValidationError(message) {
        var err = new Error(message);
        err.manufacturingWorkOrderValidationError = true;
        throw err;
    }

    function reattachTransaction(msg, outMsg) {
        if (msg.transaction) {
            Object.defineProperty(outMsg, "transaction", {
                value: msg.transaction,
                enumerable: false,
                writable: true,
                configurable: true
            });
        }
    }

    RED.nodes.registerType("manufacturing-work-order", ManufacturingWorkOrderNode);
};

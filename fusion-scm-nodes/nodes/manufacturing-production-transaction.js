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

    var MODES = {
        operationcomplete: {
            label: "Operation Complete",
            endpoint: "operationTransactions",
            detailField: "OperationTransactionDetail",
            defaults: {
                FromDispatchState: "READY",
                ToDispatchState: "COMPLETE"
            }
        },
        operationreject: {
            label: "Operation Reject",
            endpoint: "operationTransactions",
            detailField: "OperationTransactionDetail",
            defaults: {
                FromDispatchState: "READY",
                ToDispatchState: "REJECT"
            }
        },
        operationscrap: {
            label: "Operation Scrap",
            endpoint: "operationTransactions",
            detailField: "OperationTransactionDetail",
            defaults: {
                FromDispatchState: "READY",
                ToDispatchState: "SCRAP"
            }
        },
        operationreversetoready: {
            label: "Operation Reverse to Ready",
            endpoint: "operationTransactions",
            detailField: "OperationTransactionDetail",
            defaults: {
                FromDispatchState: "COMPLETE",
                ToDispatchState: "READY"
            }
        },
        materialissue: {
            label: "Material / Ingredient Issue",
            endpoint: "materialTransactions",
            detailField: "MaterialTransactionDetail",
            defaults: {
                TransactionTypeCode: "MATERIAL_ISSUE"
            }
        },
        materialreturn: {
            label: "Material / Ingredient Return",
            endpoint: "materialTransactions",
            detailField: "MaterialTransactionDetail",
            defaults: {
                TransactionTypeCode: "MATERIAL_RETURN"
            }
        },
        outputcomplete: {
            label: "Output Product Complete",
            endpoint: "materialTransactions",
            detailField: "MaterialTransactionDetail",
            defaults: {
                TransactionTypeCode: "PRODUCT_COMPLETION",
                OutputTypeCode: "PRODUCT"
            }
        },
        outputreturn: {
            label: "Output Product Return",
            endpoint: "materialTransactions",
            detailField: "MaterialTransactionDetail",
            defaults: {
                TransactionTypeCode: "PRODUCT_RETURN",
                OutputTypeCode: "PRODUCT"
            }
        }
    };

    function ManufacturingProductionTransaction(config) {
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
                var mode = resolveMode(msg.mode || config.mode || "operationComplete");
                var detail = scmMapping.resolveRequestPayload(config.payloadSource, mappings, msg, RED);
                applyModeDefaults(detail, mode);
                var payload = wrapDetail(detail, mode);
                var url = node.server.buildUrl(mode.endpoint);
                ensureHttps(url);

                node.status({ fill: "yellow", shape: "dot", text: "retrieving token..." });
                var token = await node.server.getToken();

                node.status({ fill: "yellow", shape: "dot", text: "processing..." });
                var response = await axios.post(url, payload, {
                    timeout: 30000,
                    httpsAgent: proxyAgent || undefined,
                    proxy: false,
                    headers: {
                        "Authorization": "Bearer " + token,
                        "Content-Type": "application/vnd.oracle.adf.resourceitem+json"
                    }
                });

                var outMsg = Object.assign({}, msg, {
                    payload: response.data,
                    statusCode: response.status,
                    manufacturingProductionTransaction: response.data
                });
                reattachTransaction(msg, outMsg);

                node.status({ fill: "green", shape: "dot", text: "submitted" });
                send(outMsg);
                done();
            } catch (err) {
                var validationError = err && (
                    err.productionTransactionValidationError || err.scmPayloadValidationError
                );
                scmError.handleNodeError(node, msg, err, done, {
                    statusText: validationError ? "invalid input" : "transaction failed",
                    statusShape: validationError ? "ring" : "dot"
                });
            }
        });
    }

    function resolveMode(mode) {
        var key = String(mode || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
        var modeDef = MODES[key];
        if (!modeDef) {
            throwValidationError("Manufacturing Production Transaction mode must be one of: " + Object.keys(MODES).map(function(modeKey) {
                return MODES[modeKey].label;
            }).join(", "));
        }
        return modeDef;
    }

    function applyModeDefaults(detail, mode) {
        Object.keys(mode.defaults).forEach(function(field) {
            detail[field] = mode.defaults[field];
        });
    }

    function wrapDetail(detail, mode) {
        if (Object.prototype.hasOwnProperty.call(detail, mode.detailField)) {
            return detail;
        }

        var payload = {};
        payload[mode.detailField] = [detail];
        return payload;
    }

    function buildProxyAgent(server) {
        if (server.proxyUrl && server.useProxy) {
            return new HttpsProxyAgent(server.proxyUrl);
        }
        return null;
    }

    function throwValidationError(message) {
        var err = new Error(message);
        err.productionTransactionValidationError = true;
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

    RED.nodes.registerType("manufacturing-production-transaction", ManufacturingProductionTransaction);
};

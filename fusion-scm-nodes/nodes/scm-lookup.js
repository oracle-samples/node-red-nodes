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
    const { ensureHttps, ensureAllowedHost } = require("../lib/url.js");
    const scmError = require("../lib/scm-error.js");

    const LOOKUP_TYPES = {
        installedBaseAsset: {
            endpoint: "installedBaseAssets",
            queryParam: "SerialNumber",
            configField: "queryValue",
            queryFields: [requiredQueryField("ItemNumber", "itemNumber", "Item Number", "no item number")]
        },
        meterReading: {
            endpoint: "meterReadings",
            queryParam: "AssetNumber",
            configField: "queryValue",
            queryFields: [requiredQueryField("MeterCode", "meterCode", "Meter Code", "no meter code")]
        },
        organizationId:     { endpoint: "inventoryOrganizations",   queryParam: "OrganizationName",   configField: "queryValue" },
        item: {
            endpoint: "itemsV2",
            queryParam: "ItemNumber",
            configField: "queryValue",
            queryFields: [organizationCodeField()]
        },
        subinventory: {
            endpoint: "subinventories",
            queryParam: "SecondaryInventoryName",
            configField: "queryValue",
            queryFields: [organizationCodeField()]
        },
        onHandQuantity: {
            endpoint: "inventoryOnhandBalances",
            queryParam: "ItemNumber",
            configField: "queryValue",
            queryFields: [
                organizationCodeField(),
                optionalQueryField("SubinventoryCode", "subinventoryCode")
            ]
        },
        workDefinition: {
            endpoint: "workDefinitions",
            queryParam: "WorkDefinitionName",
            configField: "queryValue",
            queryFields: [
                organizationCodeField(),
                requiredQueryField("ItemNumber", "itemNumber", "Item Number", "no item number")
            ]
        },
        recipe: {
            endpoint: "workDefinitions",
            queryParam: "WorkDefinitionName",
            configField: "queryValue",
            queryFields: [
                organizationCodeField(),
                requiredQueryField("ItemNumber", "itemNumber", "Item Number", "no item number")
            ]
        },
        manufacturingWorkOrder: {
            endpoint: "workOrders",
            queryParam: "WorkOrderNumber",
            configField: "queryValue",
            queryFields: [organizationCodeField()]
        },
        batch: {
            endpoint: "workOrders",
            queryParam: "WorkOrderNumber",
            configField: "queryValue",
            queryFields: [organizationCodeField()]
        },
        workOrderOperation: {
            path: ["workOrders", workOrderIdPath(), "child", "WorkOrderOperation"],
            queryParam: "OperationSequenceNumber",
            configField: "queryValue"
        },
        workOrderMaterial: {
            path: ["workOrders", workOrderIdPath(), "child", "WorkOrderOperation", workOrderOperationIdPath(), "child", "WorkOrderOperationMaterial"],
            queryParam: "InventoryItemNumber",
            configField: "queryValue"
        },
        workOrderResource: {
            path: ["workOrders", workOrderIdPath(), "child", "WorkOrderOperation", workOrderOperationIdPath(), "child", "WorkOrderOperationResource"],
            queryParam: "ResourceCode",
            configField: "queryValue"
        },
        workOrderOutput: {
            path: ["workOrders", workOrderIdPath(), "child", "WorkOrderOperation", workOrderOperationIdPath(), "child", "WorkOrderOperationOutput"],
            queryParam: "InventoryItemNumber",
            configField: "queryValue"
        },
        reservationStatus: {
            path: ["workOrders", workOrderIdPath(), "child", "WorkOrderOperation", workOrderOperationIdPath(), "child", "WorkOrderOperationMaterial"],
            queryParam: "InventoryItemNumber",
            configField: "queryValue"
        },
        maintenanceWorkOrder: {
            endpoint: "maintenanceWorkOrders",
            queryParam: "WorkOrderNumber",
            configField: "queryValue",
            queryFields: [organizationCodeField()]
        },
        custom:             { endpoint: "",                         queryParam: "",                   configField: "queryValue" }
    };
    const ORGANIZATION_QUERY_FIELDS = ["OrganizationName", "OrganizationCode", "OrganizationId"];

    function ScmLookupNode(config) {
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

        node.on("input", async (msg, send, done) => {
            try {
                const lookupType = config.lookupType || "custom";
                const lookup = LOOKUP_TYPES[lookupType] || LOOKUP_TYPES.custom;

                const queryValue = hasValue(msg.queryValue) ? msg.queryValue : config.queryValue;
                let queryFilters;
                try {
                    queryFilters = parseQueryFilters(msg.queryFilters !== undefined ? msg.queryFilters : config.queryFilters);
                } catch (filterErr) {
                    node.status({ fill: "red", shape: "ring", text: "invalid filters" });
                    node.error(filterErr.message, msg);
                    return done(filterErr);
                }

                if (!hasValue(queryValue) && lookupType !== "custom") {
                    node.status({ fill: "red", shape: "ring", text: "no query value" });
                    const err = new Error("No query value provided");
                    node.error(err.message, msg);
                    return done(err);
                }

                let lookupRequest;
                if (lookupType !== "custom") {
                    try {
                        lookupRequest = buildLookupRequest(lookup, queryFilters, config, msg);
                    } catch (pathErr) {
                        node.status({ fill: "red", shape: "ring", text: pathErr.statusText || "invalid lookup ID" });
                        msg.error = { message: pathErr.message, code: null };
                        node.error(pathErr.message, msg);
                        return done(pathErr);
                    }
                }

                node.status({ fill: "yellow", shape: "dot", text: "retrieving token..." });
                const token = await node.server.getToken();

                let finalUrl;
                if (lookupType === "custom") {
                    const base = config.customUrl || "";
                    if (hasValue(queryValue) && config.customQueryParam) {
                        const parsed = new URL(base);
                        if (parsed.search) {
                            const err = new Error("Custom URL must not include query parameters in custom lookup mode");
                            node.status({ fill: "red", shape: "ring", text: "invalid custom URL" });
                            node.error(err.message, msg);
                            return done(err);
                        }
                        parsed.searchParams.set("q", buildQueryExpression(config.customQueryParam, queryValue, queryFilters));
                        finalUrl = parsed.toString();
                    } else {
                        const err = new Error("Custom lookup requires both Query Param and Query Value");
                        node.status({ fill: "red", shape: "ring", text: "config error" });
                        node.error(err.message, msg);
                        return done(err);
                    }
                } else {
                    const baseUrl = node.server.buildUrl(lookupRequest.endpoint);
                    // URLSearchParams encodes special characters in queryValue.
                    const params = new URLSearchParams();
                    const queryParam = lookupType === "organizationId"
                        ? getOrganizationQueryField(config.organizationQueryField)
                        : lookup.queryParam;
                    params.set("q", buildQueryExpression(queryParam, queryValue, lookupRequest.queryFilters));
                    finalUrl = `${baseUrl}?${params.toString()}`;
                }

                if (lookupType === "custom") {
                    ensureAllowedHost(finalUrl, node.server.hostname);
                } else {
                    ensureHttps(finalUrl);
                }

                node.status({ fill: "yellow", shape: "dot", text: "reading..." });
                const response = await axios.get(finalUrl, {
                    timeout: 30000,
                    httpsAgent: proxyAgent || undefined,
                    proxy: false,
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "Content-Type": "application/json"
                    }
                });

                msg.statusCode = response.status;
                msg.payload = response.data;
                if (isEmptyCollection(response.data)) {
                    node.status({ fill: "yellow", shape: "ring", text: "not found" });
                } else {
                    node.status({ fill: "green", shape: "dot", text: "found" });
                }
                send(msg);
                done();
            } catch (err) {
                scmError.handleNodeError(node, msg, err, done, { statusText: "lookup failed" });
            }
        });
    }

    RED.nodes.registerType("scm-lookup", ScmLookupNode);

    function getOrganizationQueryField(value) {
        return ORGANIZATION_QUERY_FIELDS.includes(value) ? value : "OrganizationName";
    }

    function hasValue(value) {
        return value !== undefined && value !== null && value !== "";
    }

    function parseQueryFilters(value) {
        if (!hasValue(value)) {
            return {};
        }

        let filters = value;
        if (typeof value === "string") {
            try {
                filters = JSON.parse(value);
            } catch (e) {
                throw new Error("Additional Filters JSON is invalid: " + e.message);
            }
        }

        if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
            throw new Error("Additional Filters JSON must be an object");
        }

        const parsed = {};
        Object.keys(filters).forEach((key) => {
            if (key === "__proto__" || key === "constructor" || key === "prototype") {
                throw new Error("Additional Filters JSON contains a reserved key: " + key);
            }
            const value = filters[key];
            if (hasValue(value)) {
                parsed[key] = value;
            }
        });
        return parsed;
    }

    function assertSafeQueryValue(value) {
        // ";" separates filters in a Fusion q expression; a value containing it
        // would inject an extra filter, so reject it (field names are code-controlled).
        if (String(value).indexOf(";") !== -1) {
            throw new Error("Query value must not contain ';' (Fusion query filter separator)");
        }
    }

    function buildQueryExpression(primaryParam, primaryValue, queryFilters) {
        const parts = [];
        if (hasValue(primaryParam) && hasValue(primaryValue)) {
            assertSafeQueryValue(primaryValue);
            parts.push(`${primaryParam}=${primaryValue}`);
        }
        Object.keys(queryFilters || {}).forEach((key) => {
            assertSafeQueryValue(queryFilters[key]);
            parts.push(`${key}=${queryFilters[key]}`);
        });
        return parts.join(";");
    }

    function workOrderIdPath() {
        return {
            config: "workOrderId",
            msg: "workOrderId",
            label: "Work Order ID",
            statusText: "no work order ID"
        };
    }

    function organizationCodeField() {
        return requiredQueryField("OrganizationCode", "organizationCode", "Organization Code", "no organization code");
    }

    function requiredQueryField(queryParam, field, label, statusText) {
        return {
            queryParam: queryParam,
            config: field,
            msg: field,
            label: label,
            statusText: statusText,
            required: true
        };
    }

    function optionalQueryField(queryParam, field) {
        return {
            queryParam: queryParam,
            config: field,
            msg: field,
            required: false
        };
    }

    function workOrderOperationIdPath() {
        return {
            config: "workOrderOperationId",
            msg: "workOrderOperationId",
            label: "Operation ID",
            statusText: "no operation ID"
        };
    }

    function buildLookupRequest(lookup, queryFilters, config, msg) {
        var remainingFilters = Object.assign({}, queryFilters || {});
        (lookup.queryFields || []).forEach(function (field) {
            delete remainingFilters[field.queryParam];
            var value = resolveQueryFieldValue(field, config, msg);
            if (hasValue(value)) {
                remainingFilters[field.queryParam] = value;
            }
        });
        if (!lookup.path) {
            return {
                endpoint: lookup.endpoint,
                queryFilters: remainingFilters
            };
        }

        var endpointParts = lookup.path.map(function (part) {
            if (typeof part === "string") {
                return part;
            }
            var value = resolvePathValue(part, config, msg);
            return encodeURIComponent(value);
        });

        return {
            endpoint: endpointParts.join("/"),
            queryFilters: remainingFilters
        };
    }

    function resolveQueryFieldValue(field, config, msg) {
        if (hasValue(msg[field.msg])) {
            return msg[field.msg];
        }
        if (hasValue(config[field.config])) {
            return config[field.config];
        }
        if (!field.required) {
            return undefined;
        }
        var err = new Error(field.label + " is required for this lookup type");
        err.statusText = field.statusText;
        throw err;
    }

    function resolvePathValue(part, config, msg) {
        if (hasValue(msg[part.msg])) {
            return msg[part.msg];
        }
        if (hasValue(config[part.config])) {
            return config[part.config];
        }
        var err = new Error(part.label + " is required for this lookup type");
        err.statusText = part.statusText;
        throw err;
    }

    function isEmptyCollection(data) {
        return data && Array.isArray(data.items) && data.items.length === 0;
    }
};

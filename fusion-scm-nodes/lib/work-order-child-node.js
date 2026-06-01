var axios = require("axios");
var HttpsProxyAgent = require("https-proxy-agent").HttpsProxyAgent;
var ensureHttps = require("./url.js").ensureHttps;
var scmMapping = require("./scm-mapping.js");
var scmError = require("./scm-error.js");

function registerWorkOrderChildNode(RED, nodeType, options) {
    function WorkOrderChildNode(config) {
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
                var resource = resolveResource(config, msg, options);
                var action = resolveAction(config, msg, resource);
                var payload = actionNeedsPayload(action) ? scmMapping.resolvePayload(mappings, msg, RED) : undefined;
                var url = resolveUrl(node.server, resource, action, config, msg);
                ensureHttps(url);

                node.status({ fill: "yellow", shape: "dot", text: "retrieving token..." });
                var token = await node.server.getToken();

                node.status({ fill: "yellow", shape: "dot", text: actionStatusText(action) + "..." });
                var response = await sendRequest(action, url, payload, token, proxyAgent);
                var responseData = response.data === undefined ? null : response.data;
                var outMsg = Object.assign({}, msg, {
                    payload: responseData,
                    statusCode: response.status,
                    workOrderChild: responseData
                });
                outMsg[options.outputProperty] = responseData;
                reattachTransaction(msg, outMsg);

                node.status({ fill: "green", shape: "dot", text: actionPastTense(action) });
                send(outMsg);
                done();
            } catch (err) {
                var validationError = err && err.workOrderChildValidationError;
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

    RED.nodes.registerType(nodeType, WorkOrderChildNode);
}

function resolveResource(config, msg, options) {
    var resourceName = String(msg.resource || config.resource || options.defaultResource || "").trim();
    var resource = options.resources[resourceName];
    if (!resource) {
        throwValidationError(options.label + " resource must be one of: " + Object.keys(options.resources).join(", "));
    }
    return resource;
}

function resolveAction(config, msg, resource) {
    var action = String(msg.action || config.action || "create").trim().toLowerCase();
    if (resource.actions.indexOf(action) === -1) {
        if (resource.actions.length === 1 && resource.actions[0] === "create") {
            throwValidationError(resource.label + " supports create only");
        }
        throwValidationError(resource.label + " action must be one of: " + resource.actions.join(", "));
    }
    return action;
}

function resolveUrl(server, resource, action, config, msg) {
    var segments = [];
    for (var i = 0; i < resource.path.length; i++) {
        var part = resource.path[i];
        if (part.placeholder) {
            segments.push(resolvePlaceholder(part, config, msg));
        } else {
            segments.push(part);
        }
    }

    if (resource.itemPlaceholder && actionUsesItemId(action)) {
        segments.push(resolvePlaceholder(resource.itemPlaceholder, config, msg));
    }

    return server.buildUrl(segments.map(encodePathSegment).join("/"));
}

function resolvePlaceholder(part, config, msg) {
    var raw = msg[part.msgProperty] || config[part.configProperty];
    var value = raw == null ? "" : String(raw).trim();
    if (!value) {
        throwValidationError(part.label + " is required");
    }
    return value;
}

function encodePathSegment(segment) {
    return encodeURIComponent(segment);
}

function actionUsesItemId(action) {
    return action === "get" || action === "update" || action === "delete";
}

function actionNeedsPayload(action) {
    return action === "create" || action === "update";
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

    switch (action) {
        case "create":
            return axios.post(url, payload, options);
        case "update":
            return axios.patch(url, payload, options);
        case "list":
        case "get":
            return axios.get(url, options);
        case "delete":
            return axios.delete(url, options);
    }
    throwValidationError("Unsupported action: " + action);
}

function actionStatusText(action) {
    switch (action) {
        case "create": return "creating";
        case "update": return "updating";
        case "list":
        case "get": return "reading";
        case "delete": return "deleting";
    }
    return "requesting";
}

function actionPastTense(action) {
    switch (action) {
        case "create": return "created";
        case "update": return "updated";
        case "list":
        case "get": return "read";
        case "delete": return "deleted";
    }
    return "done";
}

function buildProxyAgent(server) {
    if (server.proxyUrl && server.useProxy) {
        return new HttpsProxyAgent(server.proxyUrl);
    }
    return null;
}

function throwValidationError(message) {
    var err = new Error(message);
    err.workOrderChildValidationError = true;
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

function workOrderId() {
    return {
        placeholder: true,
        label: "Work Order ID",
        configProperty: "workOrderId",
        msgProperty: "workOrderId"
    };
}

function operationId(label, configProperty) {
    return {
        placeholder: true,
        label: label || "Operation ID",
        configProperty: configProperty || "operationId",
        msgProperty: "operationId"
    };
}

function childRecordId(label) {
    return {
        placeholder: true,
        label: label || "Child Record ID",
        configProperty: "childRecordId",
        msgProperty: "childRecordId"
    };
}

module.exports = {
    registerWorkOrderChildNode: registerWorkOrderChildNode,
    placeholders: {
        workOrderId: workOrderId,
        operationId: operationId,
        childRecordId: childRecordId
    }
};

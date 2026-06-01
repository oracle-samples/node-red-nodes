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
    const ociError = require("../lib/oci-error.js");

    // IoT Data API version is embedded in these convenience presets. Update the
    // `/20250531/` prefix here when Oracle publishes a newer IoT Data API version.
    const ENDPOINTS = {
        rawData: "/20250531/rawData",
        rejectedData: "/20250531/rejectedData",
        snapshotData: "/20250531/snapshotData",
        historizedData: "/20250531/historizedData",
        rawCommandData: "/20250531/rawCommandData"
    };

    function parseJsonObject(rawValue, label, ordsConfig) {
        var trimmed = String(rawValue || "").trim();
        if (!trimmed) return {};
        var parsed;
        try {
            parsed = JSON.parse(trimmed);
        } catch (err) {
            throw new Error(label + " must be valid JSON");
        }
        return ordsConfig.assertPlainObject(parsed, label);
    }

    function parseJsonBody(rawValue) {
        var trimmed = String(rawValue || "").trim();
        if (!trimmed) return undefined;
        try {
            return JSON.parse(trimmed);
        } catch (err) {
            throw new Error("Body must be valid JSON");
        }
    }

    function methodAllowsBody(method) {
        return method !== "GET" && method !== "HEAD";
    }

    function buildPath(operation, customPath, recordId, ordsConfig) {
        var path = operation === "custom" ? String(customPath || "").trim() : ENDPOINTS[operation];
        if (!path) {
            throw new Error("No ORDS endpoint configured");
        }
        ordsConfig.assertRelativePath(path);
        if (recordId !== undefined && recordId !== null && String(recordId).trim() !== "") {
            path = path.replace(/\/+$/, "") + "/" + String(recordId).trim();
        }
        return path;
    }

    function OciOrdsRequestNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.ordsConfig = RED.nodes.getNode(config.ordsConfig);
        if (!node.ordsConfig) {
            node.status({ fill: "red", shape: "ring", text: "no ORDS config" });
            node.error("No ORDS Config configured");
            return;
        }

        node.operation = config.operation || "custom";
        node.method = config.method || "GET";
        node.recordId = config.recordId || "";
        node.query = config.query || "";
        node.headers = config.headers || "";
        node.body = config.body || "";
        node.customPath = config.customPath || "";

        node.on("input", async function (msg, send, done) {
            try {
                var operation = msg.operation || node.operation || "custom";
                if (operation !== "custom" && !ENDPOINTS[operation]) {
                    throw new Error("Unsupported ORDS operation: " + operation);
                }

                var configuredMethod = node.ordsConfig.normalizeMethod(node.method);
                var method = node.ordsConfig.normalizeMethod(msg.method || node.method);
                var recordId = msg.recordId !== undefined ? msg.recordId : node.recordId;
                var customPath = msg.customPath !== undefined ? msg.customPath : node.customPath;
                var path = buildPath(operation, customPath, recordId, node.ordsConfig);
                var queryParams = node.ordsConfig.buildQueryParams(node.query, msg);
                var headers = node.ordsConfig.normalizeHeadersObject(
                    parseJsonObject(node.headers, "Headers", node.ordsConfig),
                    "Headers"
                );
                if (msg.headers !== undefined) {
                    headers = node.ordsConfig.mergeHeaders(
                        headers,
                        node.ordsConfig.normalizeHeadersObject(
                            node.ordsConfig.assertPlainObject(msg.headers, "msg.headers"),
                            "msg.headers"
                        )
                    );
                }
                var body = undefined;
                if (methodAllowsBody(method)) {
                    var configuredBody = methodAllowsBody(configuredMethod) ? parseJsonBody(node.body) : undefined;
                    body = configuredBody !== undefined ? configuredBody : msg.payload;
                }

                node.status({ fill: "yellow", shape: "dot", text: "requesting" });
                var requestOptions = {
                    method: method,
                    path: path,
                    queryParams: queryParams,
                    body: body
                };
                if (Object.keys(headers).length > 0) {
                    requestOptions.headers = headers;
                }
                var response = await node.ordsConfig.request(requestOptions);

                node.status({ fill: "green", shape: "dot", text: "received" });
                var outMsg = Object.assign({}, msg, {
                    payload: response.data,
                    statusCode: response.statusCode,
                    responseHeaders: response.headers || {},
                    ordsUrl: response.url,
                    ordsOperation: operation
                });
                send(outMsg);
                done();
            } catch (err) {
                var validation = /No ORDS endpoint|relative ORDS path|Unsupported ORDS|Headers must|Body must|msg.headers must|reserved keys/.test(err.message || "");
                ociError.handleNodeError(node, msg, err, done, {
                    statusText: validation ? "invalid request" : "request failed",
                    statusShape: validation ? "ring" : "dot"
                });
            }
        });
    }

    RED.nodes.registerType("oci-ords-request", OciOrdsRequestNode);
};

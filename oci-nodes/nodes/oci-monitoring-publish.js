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
    var monitoring = require("oci-monitoring");
    var ociError = require("../lib/oci-error.js");

    function validationError(message) {
        var err = new Error(message);
        err.isValidationError = true;
        return err;
    }

    function parseMap(value, label) {
        if (!value) return {};
        var parsed;
        try {
            parsed = typeof value === "string" ? JSON.parse(value) : value;
        } catch (err) {
            throw validationError(label + " must be a valid JSON object");
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw validationError(label + " must be a JSON object");
        }
        var result = {};
        Object.keys(parsed).forEach(function (key) {
            if (typeof parsed[key] !== "string") {
                throw validationError(label + " values must be strings");
            }
            result[key] = parsed[key];
        });
        return result;
    }

    function requiredString(value, label) {
        if (typeof value !== "string" || !value.trim()) {
            throw validationError(label + " is required");
        }
        return value.trim();
    }

    function parseTimestamp(value) {
        var timestamp = value === undefined || value === null || value === "" ? new Date() : new Date(value);
        if (Number.isNaN(timestamp.getTime())) {
            throw validationError("Metric timestamp must be a valid date/time");
        }
        return timestamp;
    }

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

    function OciMonitoringPublishNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.ociConfig = RED.nodes.getNode(config.ociConfig);
        if (!node.ociConfig) {
            node.status({ fill: "red", shape: "ring", text: "no OCI config" });
            node.error("No OCI Config configured");
            return;
        }

        node.compartmentOcid = config.compartmentOcid || "";
        node.namespace = config.namespace || "";
        node.metricName = config.metricName || "";
        node.resourceGroup = config.resourceGroup || "";
        node.dimensions = config.dimensions || "{}";
        node.metadata = config.metadata || "{}";
        var clientPromise;

        function getClient() {
            if (!clientPromise) {
                clientPromise = node.ociConfig.getAuthProvider().then(function (provider) {
                    var client = new monitoring.MonitoringClient({
                        authenticationDetailsProvider: provider
                    });
                    var region = node.ociConfig.getRegion();
                    if (region) client.regionId = region;
                    if (!client.endpoint) {
                        throw validationError("OCI region is required to resolve the Monitoring endpoint");
                    }

                    var queryEndpoint = client.endpoint.replace(/\/20180401\/?$/, "");
                    var ingestionEndpoint = queryEndpoint.replace(
                        /^https:\/\/telemetry\./,
                        "https://telemetry-ingestion."
                    );
                    if (ingestionEndpoint === queryEndpoint) {
                        throw new Error("Unable to derive the OCI Monitoring ingestion endpoint");
                    }
                    client.endpoint = ingestionEndpoint;
                    return client;
                }).catch(function (err) {
                    clientPromise = null;
                    throw err;
                });
            }
            return clientPromise;
        }

        node.on("input", async function (msg, send, done) {
            try {
                var input;
                if (typeof msg.payload === "number") {
                    input = { value: msg.payload };
                } else if (msg.payload && typeof msg.payload === "object" && !Array.isArray(msg.payload)) {
                    input = msg.payload;
                } else {
                    throw validationError("Metric payload must be a finite number or an object with a value field");
                }

                if (typeof input.value !== "number" || !Number.isFinite(input.value)) {
                    throw validationError("Metric value must be a finite number");
                }

                var compartmentId = requiredString(
                    input.compartmentId || node.compartmentOcid || node.ociConfig.getCompartmentOcid(),
                    "Compartment OCID"
                );
                var namespace = requiredString(input.namespace || node.namespace, "Metric namespace");
                var metricName = requiredString(input.name || node.metricName, "Metric name");
                var dimensions = input.dimensions === undefined
                    ? parseMap(node.dimensions, "Dimensions")
                    : parseMap(input.dimensions, "Dimensions");
                var metadata = input.metadata === undefined
                    ? parseMap(node.metadata, "Metadata")
                    : parseMap(input.metadata, "Metadata");
                var datapoint = {
                    timestamp: parseTimestamp(input.timestamp),
                    value: input.value
                };

                if (input.count !== undefined && input.count !== null && input.count !== "") {
                    if (typeof input.count !== "number" || !Number.isFinite(input.count) || input.count <= 0) {
                        throw validationError("Metric count must be a positive number");
                    }
                    datapoint.count = input.count;
                }

                var metric = {
                    compartmentId: compartmentId,
                    namespace: namespace,
                    name: metricName,
                    dimensions: dimensions,
                    metadata: metadata,
                    datapoints: [datapoint]
                };
                var resourceGroup = input.resourceGroup || node.resourceGroup;
                if (resourceGroup) metric.resourceGroup = String(resourceGroup);

                node.status({ fill: "yellow", shape: "dot", text: "publishing" });
                var client = await getClient();
                var response = await client.postMetricData({
                    postMetricDataDetails: {
                        metricData: [metric]
                    }
                });
                var details = response.postMetricDataResponseDetails || {};
                var statusCode = response.__httpStatusCode || 200;
                var publication = {
                    failedMetricsCount: details.failedMetricsCount || 0,
                    failedMetrics: details.failedMetrics || [],
                    opcRequestId: response.opcRequestId || null,
                    statusCode: statusCode
                };
                if (Number(publication.failedMetricsCount) > 0) {
                    var rejectedError = new Error("OCI Monitoring rejected the metric");
                    rejectedError.serviceCode = "MetricRejected";
                    rejectedError.statusCode = statusCode;
                    rejectedError.opcRequestId = publication.opcRequestId;
                    rejectedError.responseData = Object.assign({
                        message: rejectedError.message,
                        code: rejectedError.serviceCode
                    }, publication);
                    throw rejectedError;
                }
                var outMsg = Object.assign({}, msg, {
                    payload: publication,
                    statusCode: statusCode,
                    opcRequestId: response.opcRequestId || null
                });
                preserveTransaction(outMsg, msg);

                node.status({ fill: "green", shape: "dot", text: "published" });
                send(outMsg);
                done();
            } catch (err) {
                ociError.handleNodeError(node, msg, err, done, {
                    statusShape: err.isValidationError ? "ring" : "dot",
                    statusText: err.isValidationError ? "invalid metric" : "publish failed"
                });
            }
        });
    }

    RED.nodes.registerType("oci-monitoring-publish", OciMonitoringPublishNode);
};

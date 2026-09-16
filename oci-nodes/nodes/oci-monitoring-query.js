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

    function requiredString(value, label) {
        if (typeof value !== "string" || !value.trim()) {
            throw validationError(label + " is required");
        }
        return value.trim();
    }

    function parseTime(value, label) {
        var parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            throw validationError(label + " must be a valid date/time");
        }
        return parsed;
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

    function OciMonitoringQueryNode(config) {
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
        node.query = config.query || "";
        node.resourceGroup = config.resourceGroup || "";
        node.resolution = config.resolution || "";
        node.lookbackMinutes = Number(config.lookbackMinutes || 60);
        var clientPromise;

        function getClient() {
            if (!clientPromise) {
                clientPromise = node.ociConfig.getAuthProvider().then(function (provider) {
                    var client = new monitoring.MonitoringClient({
                        authenticationDetailsProvider: provider
                    });
                    var region = node.ociConfig.getRegion();
                    if (region) client.regionId = region;
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
                var input = msg.metricQuery === undefined ? {} : msg.metricQuery;
                if (!input || typeof input !== "object" || Array.isArray(input)) {
                    throw validationError("msg.metricQuery must be an object");
                }

                var compartmentId = requiredString(
                    input.compartmentId || node.compartmentOcid || node.ociConfig.getCompartmentOcid(),
                    "Compartment OCID"
                );
                var namespace = requiredString(input.namespace || node.namespace, "Metric namespace");
                var query = requiredString(input.query || node.query, "MQL query");
                var lookbackMinutes = input.lookbackMinutes === undefined
                    ? node.lookbackMinutes
                    : Number(input.lookbackMinutes);
                if (!Number.isFinite(lookbackMinutes) || lookbackMinutes <= 0) {
                    throw validationError("Lookback minutes must be a positive number");
                }

                var endTime = input.endTime === undefined || input.endTime === null || input.endTime === ""
                    ? new Date()
                    : parseTime(input.endTime, "End time");
                var startTime = input.startTime === undefined || input.startTime === null || input.startTime === ""
                    ? new Date(endTime.getTime() - (lookbackMinutes * 60000))
                    : parseTime(input.startTime, "Start time");
                if (startTime.getTime() >= endTime.getTime()) {
                    throw validationError("Start time must be before end time");
                }

                var details = {
                    namespace: namespace,
                    query: query,
                    startTime: startTime,
                    endTime: endTime
                };
                var resourceGroup = input.resourceGroup === undefined ? node.resourceGroup : input.resourceGroup;
                var resolution = input.resolution === undefined ? node.resolution : input.resolution;
                if (resourceGroup) details.resourceGroup = String(resourceGroup);
                if (resolution) details.resolution = String(resolution);

                node.status({ fill: "yellow", shape: "dot", text: "querying" });
                var client = await getClient();
                var response = await client.summarizeMetricsData({
                    compartmentId: compartmentId,
                    summarizeMetricsDataDetails: details
                });
                var statusCode = response.__httpStatusCode || 200;
                var outMsg = Object.assign({}, msg, {
                    payload: response.items || [],
                    statusCode: statusCode,
                    opcRequestId: response.opcRequestId || null
                });
                preserveTransaction(outMsg, msg);

                node.status({ fill: "green", shape: "dot", text: "queried" });
                send(outMsg);
                done();
            } catch (err) {
                ociError.handleNodeError(node, msg, err, done, {
                    statusShape: err.isValidationError ? "ring" : "dot",
                    statusText: err.isValidationError ? "invalid query" : "query failed"
                });
            }
        });
    }

    RED.nodes.registerType("oci-monitoring-query", OciMonitoringQueryNode);
};

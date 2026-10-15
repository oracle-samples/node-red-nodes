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
    var common = require("oci-common");
    var ociError = require("../lib/oci-error.js");
    var sensitive = require("../lib/oci-sensitive.js");
    var configBudgets = new WeakMap();

    function failure(code, message, validation) {
        var err = new Error(message);
        err.code = code;
        err.isValidation = !!validation;
        return err;
    }

    function invalid(message) {
        return failure("MonitoringInvalidInput", message, true);
    }

    function requiredString(value, label) {
        if (typeof value !== "string" || !value.trim()) throw invalid(label + " is required");
        return value.trim();
    }

    function integerSetting(value, fallback, minimum, maximum, label) {
        if (value === undefined) return fallback;
        if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) {
            throw invalid(label + " must be an integer");
        }
        var number = Number(value);
        if (!Number.isInteger(number) || number < minimum || number > maximum) {
            throw invalid(label + " must be between " + minimum + " and " + maximum);
        }
        return number;
    }

    function unicodeLength(value) {
        var length = 0;
        for (var i = 0; i < value.length; i++, length++) {
            var code = value.charCodeAt(i);
            if (code >= 0xD800 && code <= 0xDBFF) {
                var next = value.charCodeAt(++i);
                if (!(next >= 0xDC00 && next <= 0xDFFF)) return Infinity;
            } else if (code >= 0xDC00 && code <= 0xDFFF) {
                return Infinity;
            }
        }
        return length;
    }

    function parseMap(value, dimensions) {
        var label = dimensions ? "Dimensions" : "Metadata";
        var parsed;
        try {
            parsed = typeof value === "string" ? JSON.parse(value) : value;
        } catch (err) {
            throw invalid(label + " must be a valid JSON object");
        }
        var prototype = parsed && typeof parsed === "object" ? Object.getPrototypeOf(parsed) : undefined;
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" ||
                (prototype !== null && Object.getPrototypeOf(prototype) !== null)) {
            throw invalid(label + " must be a JSON object");
        }
        var keys = Object.keys(parsed);
        if (dimensions && (keys.length < 1 || keys.length > 20)) {
            throw invalid("Dimensions must contain 1 to 20 entries");
        }
        var result = {};
        keys.forEach(function (key) {
            var entry = parsed[key];
            if (unicodeLength(key) > 256 || (dimensions && !/^[\x21-\x7e]+$/.test(key))) {
                throw invalid(label + " contains an invalid key");
            }
            if (typeof entry !== "string" || (dimensions && !entry.length) || unicodeLength(entry) > (dimensions ? 512 : 256)) {
                throw invalid(label + " contains an invalid string value");
            }
            Object.defineProperty(result, key, {
                value: entry, enumerable: true, writable: true, configurable: true
            });
        });
        return result;
    }

    function timestamp(value) {
        var result;
        if (value instanceof Date) {
            result = new Date(value.getTime());
        } else if (typeof value === "number" && Number.isInteger(value)) {
            result = new Date(value);
        } else if (typeof value === "string") {
            var parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
            if (!parts) throw invalid("msg.timestamp must be an ISO timestamp with a timezone, Date, or integer Unix milliseconds");
            var year = Number(parts[1]);
            var month = Number(parts[2]);
            var day = Number(parts[3]);
            var leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
            var days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
            if (month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
                    Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6]) > 59 ||
                    (parts[8] !== "Z" && (Number(parts[8].slice(1, 3)) > 23 || Number(parts[8].slice(4)) > 59))) {
                throw invalid("msg.timestamp contains an invalid calendar date or timezone");
            }
            // OCI's Date serializer uses milliseconds; discard finer precision without rounding forward.
            result = new Date(parts.slice(1, 4).join("-") + "T" + parts.slice(4, 7).join(":") +
                (parts[7] ? "." + (parts[7] + "00").slice(0, 3) : "") + parts[8]);
        }
        if (!result || !Number.isFinite(result.getTime())) throw invalid("msg.timestamp is not a valid timestamp");
        return result;
    }

    function OciT2PublishNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        var ociConfig = RED.nodes.getNode(config.ociConfig);
        var queue = [];
        var active = new Set();
        var closed = false;
        var nextRequestAt = 0;
        var settings;
        var configError;
        var budget;
        try {
            if (!ociConfig) throw invalid("No OCI Config configured");
            var namespace = requiredString(config.namespace, "Metric namespace");
            if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(namespace) || /^(oci_|oracle_)/i.test(namespace)) {
                throw invalid("Metric namespace must use letters, digits and underscores without a reserved prefix");
            }
            var name = requiredString(config.metricName, "Metric name");
            if (!/^[A-Za-z][A-Za-z0-9._$-]*$/.test(name)) throw invalid("Metric name has invalid characters");
            var resourceGroup = config.resourceGroup === undefined || config.resourceGroup === "" ? "" : requiredString(config.resourceGroup, "Resource group");
            if (resourceGroup && !/^[A-Za-z][A-Za-z0-9._$-]*$/.test(resourceGroup)) throw invalid("Resource group has invalid characters");
            settings = {
                namespace: namespace,
                name: name,
                resourceGroup: resourceGroup,
                dimensions: parseMap(config.dimensions, true),
                metadata: parseMap(config.metadata === undefined || config.metadata === "" ? "{}" : config.metadata, false),
                maxConcurrent: integerSetting(config.maxConcurrent, 4, 1, 32, "Max concurrent"),
                maxQueue: integerSetting(config.maxQueue, 100, 1, 10000, "Max queue"),
                requestsPerSecond: integerSetting(config.requestsPerSecond, 20, 1, 50, "Requests per second"),
                timeoutMs: integerSetting(config.timeoutMs, 30000, 1000, 300000, "Timeout")
            };
            if (!configBudgets.has(ociConfig)) configBudgets.set(ociConfig, { nextRequestAt: 0 });
            budget = configBudgets.get(ociConfig);
        } catch (err) {
            configError = err;
            node.status({ fill: "red", shape: "ring", text: "invalid configuration" });
        }

        function assertLive(job) {
            if (closed) throw failure("MonitoringNodeClosed", "Monitoring publisher is closed", true);
            if (job.settled || Date.now() >= job.deadline) throw failure("MonitoringTimeout", "Monitoring publication timed out");
        }

        function dispose(job) {
            if (!job.client) return;
            var client = job.client;
            job.client = null;
            try {
                client.shutdownCircuitBreaker();
            } catch (err) {
                node.warn("Monitoring client circuit-breaker cleanup failed");
            }
        }

        function finish(job, err, publication) {
            if (job.settled) return;
            job.settled = true;
            clearTimeout(job.timer);
            clearTimeout(job.rateTimer);
            if (err) {
                job.controller.abort();
                if (job.cancelRate) job.cancelRate(err);
                dispose(job);
                ociError.handleNodeError(node, job.msg, err, job.done, {
                    setPayload: err.code === "MetricRejected",
                    statusShape: err.isValidation || !job.executing ? "ring" : "dot",
                    statusText: err.isValidation ? "invalid metric" : "publish failed"
                });
            } else {
                var outMsg = Object.assign({}, job.msg, {
                    payload: publication,
                    statusCode: publication.statusCode,
                    opcRequestId: publication.opcRequestId
                });
                if (job.msg.transaction) {
                    Object.defineProperty(outMsg, "transaction", {
                        value: job.msg.transaction, enumerable: false, writable: true, configurable: true
                    });
                }
                node.status({ fill: "green", shape: "dot", text: "published" });
                job.send(outMsg);
                job.done();
            }
        }

        function awaitRate(job) {
            return new Promise(function (resolve, reject) {
                job.cancelRate = reject;
                function attempt() {
                    try {
                        assertLive(job);
                        var now = Date.now();
                        var wait = Math.max(nextRequestAt, budget.nextRequestAt) - now;
                        if (wait > 0) {
                            job.rateTimer = setTimeout(attempt, Math.ceil(wait));
                            node.status({ fill: "yellow", shape: "ring", text: "waiting to publish" });
                            return;
                        }
                        nextRequestAt = now + 1000 / settings.requestsPerSecond;
                        budget.nextRequestAt = now + 20;
                        job.cancelRate = null;
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                }
                attempt();
            });
        }

        async function publish(job) {
            var sdkFailure;
            var sdkDiagnostic;
            try {
                assertLive(job);
                job.executing = true;
                node.status({ fill: "yellow", shape: "dot", text: "authenticating" });
                var provider = await ociConfig.getAuthProvider();
                assertLive(job);
                job.executing = false;
                await awaitRate(job);
                assertLive(job);
                var clientOptions = sensitive.clientConfiguration(common, job.controller.signal);
                var sanitizeFailure = clientOptions.retryConfiguration.retryCondition;
                clientOptions.retryConfiguration.retryCondition = function (err) {
                    // Preserve sanitized Catch details before the SDK emits its own diagnostics.
                    sdkFailure = err;
                    sdkDiagnostic = ociError.normalizeError(err);
                    return sanitizeFailure(err);
                };
                var client = new monitoring.MonitoringClient({ authenticationDetailsProvider: provider }, clientOptions);
                job.client = client;
                Object.defineProperty(client, "logger", { value: null, configurable: true });
                var region = ociConfig.getRegion();
                if (region) client.regionId = region;
                var endpoint = client.endpoint && client.endpoint.replace(/\/20180401\/?$/, "");
                if (!endpoint || !/^https:\/\/telemetry\./.test(endpoint)) {
                    throw invalid("OCI region is required to resolve the Monitoring ingestion endpoint");
                }
                client.endpoint = endpoint.replace(/^https:\/\/telemetry\./, "https://telemetry-ingestion.");
                assertLive(job);
                job.executing = true;
                node.status({ fill: "yellow", shape: "dot", text: "publishing" });
                var response = await client.postMetricData({
                    retryConfiguration: clientOptions.retryConfiguration,
                    postMetricDataDetails: { metricData: [job.metric] }
                });
                assertLive(job);
                var details = response && response.postMetricDataResponseDetails;
                if (!details || typeof details !== "object" || Array.isArray(details) ||
                        !Number.isInteger(details.failedMetricsCount) || details.failedMetricsCount < 0 ||
                        (details.failedMetrics !== undefined && !Array.isArray(details.failedMetrics))) {
                    var invalidResponse = failure("MonitoringInvalidResponse", "OCI Monitoring returned an invalid publication response");
                    invalidResponse.statusCode = response && response.__httpStatusCode || 200;
                    invalidResponse.opcRequestId = response && response.opcRequestId;
                    throw invalidResponse;
                }
                var publication = {
                    failedMetricsCount: details.failedMetricsCount,
                    failedMetrics: details.failedMetrics || [],
                    opcRequestId: response.opcRequestId || null,
                    statusCode: response.__httpStatusCode || 200
                };
                if (Number(publication.failedMetricsCount) > 0 || publication.failedMetrics.length) {
                    var rejected = failure("MetricRejected", "OCI Monitoring rejected the metric");
                    rejected.statusCode = publication.statusCode;
                    rejected.opcRequestId = publication.opcRequestId;
                    rejected.responseData = Object.assign({ message: rejected.message, code: rejected.code }, publication);
                    throw rejected;
                }
                finish(job, null, publication);
            } catch (err) {
                if (err === sdkFailure && sdkDiagnostic) {
                    err = failure(sdkDiagnostic.code, sdkDiagnostic.message);
                    err.statusCode = sdkDiagnostic.statusCode;
                    err.opcRequestId = sdkDiagnostic.opcRequestId;
                }
                finish(job, err);
            } finally {
                dispose(job);
                active.delete(job);
                pump();
            }
        }

        function pump() {
            while (!closed && queue.length && active.size < settings.maxConcurrent) {
                var job = queue.shift();
                if (job.settled) continue;
                active.add(job);
                // Keep the slot until actual auth/network work settles, even after reporting a timeout.
                publish(job);
            }
        }

        node.on("input", function (msg, send, done) {
            send = send || function (outMsg) { node.send(outMsg); };
            done = done || function (err) { if (err) node.error(err, msg); };
            var job;
            try {
                if (closed) throw failure("MonitoringNodeClosed", "Monitoring publisher is closed", true);
                if (configError) throw configError;
                if (typeof msg.data !== "number" || !Number.isFinite(msg.data)) throw invalid("msg.data must be a finite number");
                var metric = {
                    namespace: settings.namespace,
                    name: settings.name,
                    compartmentId: requiredString(config.compartmentOcid === undefined || config.compartmentOcid === ""
                        ? ociConfig.getCompartmentOcid() : config.compartmentOcid, "Compartment OCID"),
                    dimensions: settings.dimensions,
                    metadata: settings.metadata,
                    datapoints: [{ timestamp: timestamp(msg.timestamp), value: msg.data }]
                };
                if (settings.resourceGroup) metric.resourceGroup = settings.resourceGroup;
                if (queue.length >= settings.maxQueue) throw failure("MonitoringQueueFull", "Monitoring publication queue is full", true);
                job = {
                    msg: msg, send: send, done: done, metric: metric,
                    deadline: Date.now() + settings.timeoutMs,
                    controller: new AbortController(), settled: false, executing: false
                };
                job.timer = setTimeout(function () {
                    finish(job, failure("MonitoringTimeout", "Monitoring publication timed out"));
                    var index = queue.indexOf(job);
                    if (index !== -1) queue.splice(index, 1);
                    pump();
                }, settings.timeoutMs);
                queue.push(job);
                node.status({ fill: "yellow", shape: "ring", text: "waiting to publish" });
                pump();
            } catch (err) {
                if (job) finish(job, err);
                else ociError.handleNodeError(node, msg, err, done, {
                    setPayload: false, statusShape: "ring", statusText: "invalid metric"
                });
            }
        });

        node.on("close", function (removed, done) {
            closed = true;
            var err = failure("MonitoringNodeClosed", "Monitoring publisher is closed", true);
            queue.forEach(function (job) { finish(job, err); });
            queue = [];
            active.forEach(function (job) {
                finish(job, err);
                job.controller.abort();
                dispose(job);
            });
            if (typeof removed === "function") removed();
            else if (typeof done === "function") done();
        });
    }

    RED.nodes.registerType("oci-t2-publish", OciT2PublishNode);
};

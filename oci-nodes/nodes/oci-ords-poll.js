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
    const TERMINAL_STATUSES = ["COMPLETED", "FAILED", "EXPIRED", "NOT_RESPONDED", "REFUSED"];

    function parsePositiveInt(value, fallback, minimum, maximum) {
        var parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < minimum) return fallback;
        parsed = Math.floor(parsed);
        if (maximum && parsed > maximum) return maximum;
        return parsed;
    }

    function createCloseError() {
        var err = new Error("ORDS poll canceled because the node closed");
        err.code = "ORDS_NODE_CLOSED";
        return err;
    }

    function getFirstValue(data, names) {
        if (!data || typeof data !== "object") return undefined;
        for (var i = 0; i < names.length; i += 1) {
            if (data[names[i]] !== undefined && data[names[i]] !== null) {
                return data[names[i]];
            }
        }
        return undefined;
    }

    function getCommandData(data) {
        if (!data || typeof data !== "object") return data;
        if (getFirstValue(data, ["delivery_status", "deliveryStatus", "DELIVERY_STATUS"]) !== undefined) {
            return data;
        }
        if (Array.isArray(data.items) && data.items.length > 0) {
            return data.items[0];
        }
        if (data.item && typeof data.item === "object") {
            return data.item;
        }
        if (data.value && typeof data.value === "object") {
            return data.value;
        }
        return data;
    }

    function getDeliveryStatus(data) {
        var value = getFirstValue(getCommandData(data), ["delivery_status", "deliveryStatus", "DELIVERY_STATUS"]);
        return value === undefined ? null : String(value).toUpperCase();
    }

    function getResponseData(data) {
        return getFirstValue(getCommandData(data), ["response_data", "responseData", "RESPONSE_DATA"]);
    }

    function getByPath(data, path) {
        if (!path) return undefined;
        return String(path).split(".").reduce(function (value, key) {
            return value && value[key] !== undefined ? value[key] : undefined;
        }, data);
    }

    function isPresent(value) {
        if (value === undefined || value === null) return false;
        if (typeof value === "string" && value.length === 0) return false;
        if (Array.isArray(value) && value.length === 0) return false;
        return true;
    }

    function commandComplete(data, waitFor) {
        var status = getDeliveryStatus(data);
        var responseData = getResponseData(data);
        if (waitFor === "completed") {
            return status === "COMPLETED";
        }
        if (waitFor === "response") {
            return isPresent(responseData) || TERMINAL_STATUSES.indexOf(status) !== -1;
        }
        return TERMINAL_STATUSES.indexOf(status) !== -1;
    }

    function customComplete(data, mode, property, expectedValue) {
        var value = getByPath(data, property);
        switch (mode) {
            case "exists":
                return value !== undefined && value !== null;
            case "equals":
                return String(value) === String(expectedValue);
            case "notEmpty":
            default:
                return isPresent(value);
        }
    }

    function buildPath(pollType, customPath, recordId, ordsConfig) {
        var path;
        if (pollType === "commandStatus") {
            if (!recordId) {
                throw new Error("No Raw Command Data record ID configured or provided in msg.recordId");
            }
            path = "/20250531/rawCommandData/" + String(recordId).trim();
        } else {
            path = String(customPath || "").trim();
            if (!path) {
                throw new Error("No custom ORDS path configured or provided in msg.customPath");
            }
        }
        ordsConfig.assertRelativePath(path);
        return path;
    }

    function OciOrdsPollNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.ordsConfig = RED.nodes.getNode(config.ordsConfig);
        if (!node.ordsConfig) {
            node.status({ fill: "red", shape: "ring", text: "no ORDS config" });
            node.error("No ORDS Config configured");
            return;
        }

        node.pollType = config.pollType || "commandStatus";
        node.recordId = config.recordId || "";
        node.intervalMs = parsePositiveInt(config.intervalMs, 2000, 1, 300000);
        node.timeoutMs = parsePositiveInt(config.timeoutMs, 60000, 1, 3600000);
        node.waitFor = config.waitFor || "terminal";
        node.customPath = config.customPath || "";
        node.query = config.query || "";
        node.successProperty = config.successProperty || "items";
        node.successMode = config.successMode || "notEmpty";
        node.successValue = config.successValue || "";
        var closing = false;
        const waiters = new Set();

        function ensureOpen() {
            if (closing) {
                throw createCloseError();
            }
        }

        function waitForInterval(ms) {
            ensureOpen();
            return new Promise(function (resolve, reject) {
                var waiter = {
                    timer: null,
                    reject: reject
                };
                waiter.timer = setTimeout(function () {
                    waiters.delete(waiter);
                    resolve();
                }, ms);
                waiters.add(waiter);
            });
        }

        async function pollOnce(msg) {
            ensureOpen();
            var pollType = msg.pollType || node.pollType;
            var recordId = msg.recordId !== undefined ? msg.recordId : node.recordId;
            var customPath = msg.customPath !== undefined ? msg.customPath : node.customPath;
            var intervalMs = parsePositiveInt(msg.intervalMs, node.intervalMs, 1, 300000);
            var timeoutMs = parsePositiveInt(msg.timeoutMs, node.timeoutMs, 1, 3600000);
            var path = buildPath(pollType, customPath, recordId, node.ordsConfig);
            var queryParams = node.ordsConfig.buildQueryParams(node.query, msg);
            var deadline = Date.now() + timeoutMs;
            var attempts = 0;
            var lastResponse = null;

            while (true) {
                ensureOpen();
                attempts += 1;
                lastResponse = await node.ordsConfig.request({
                    method: "GET",
                    path: path,
                    queryParams: queryParams
                });

                var data = lastResponse.data;
                var complete = pollType === "commandStatus"
                    ? commandComplete(data, node.waitFor)
                    : customComplete(data, node.successMode, node.successProperty, node.successValue);
                if (complete) {
                    return {
                        response: lastResponse,
                        complete: true,
                        timedOut: false,
                        attempts: attempts
                    };
                }

                if (Date.now() + intervalMs >= deadline) {
                    return {
                        response: lastResponse,
                        complete: false,
                        timedOut: true,
                        attempts: attempts
                    };
                }
                await waitForInterval(intervalMs);
            }
        }

        node.on("input", async function (msg, send, done) {
            try {
                node.status({ fill: "yellow", shape: "ring", text: "polling" });
                var result = await node.ordsConfig.runPollJob(function () {
                    return pollOnce(msg);
                });
                var response = result.response;
                var data = response ? response.data : null;
                var status = getDeliveryStatus(data);

                node.status({
                    fill: result.complete ? "green" : "yellow",
                    shape: result.complete ? "dot" : "ring",
                    text: result.complete ? "poll complete" : "poll timed out"
                });

                var outMsg = Object.assign({}, msg, {
                    payload: data,
                    statusCode: response ? response.statusCode : 0,
                    responseHeaders: response ? response.headers || {} : {},
                    ordsUrl: response ? response.url : null,
                    pollComplete: result.complete,
                    pollTimedOut: result.timedOut,
                    pollAttempts: result.attempts,
                    deliveryStatus: status
                });
                send(outMsg);
                done();
            } catch (err) {
                var validation = /No Raw Command Data|No custom ORDS path|relative ORDS path/.test(err.message || "");
                ociError.handleNodeError(node, msg, err, done, {
                    statusText: validation ? "invalid poll" : "poll failed",
                    statusShape: validation ? "ring" : "dot"
                });
            }
        });

        node.on("close", function (_removed, done) {
            closing = true;
            waiters.forEach(function (waiter) {
                clearTimeout(waiter.timer);
                waiter.reject(createCloseError());
            });
            waiters.clear();
            if (typeof done === "function") {
                done();
            }
        });
    }

    RED.nodes.registerType("oci-ords-poll", OciOrdsPollNode);
};

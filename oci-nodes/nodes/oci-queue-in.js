/* Copyright (c) 2026 Oracle and/or its affiliates. Licensed under the UPL, Version 1.0. */

module.exports = function (RED) {
    var queueSupport = require("../lib/oci-queue.js");
    var ociError = require("../lib/oci-error.js");

    function OciQueueInNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        node.queueConfig = RED.nodes.getNode(config.queueConfig);
        if (!node.queueConfig) {
            node.status({ fill: "red", shape: "ring", text: "no Queue config" });
            node.error("No OCI Queue Config configured");
            return;
        }

        var settings;
        try {
            settings = readSettings(config);
            settings.queueId = node.queueConfig.getQueueOcid();
        } catch (err) {
            node.status({ fill: "red", shape: "ring", text: "invalid settings" });
            node.error(err.message);
            return;
        }

        var closing = false;
        var receiveController = new AbortController();
        var client = null;
        var startHandle = null;
        var retryTimer = null;
        var retryResolve = null;
        var statusResetTimer = null;

        function clearStatusResetTimer() {
            if (!statusResetTimer) return;
            clearTimeout(statusResetTimer);
            statusResetTimer = null;
        }

        function setWaitingStatus() {
            if (!closing && !statusResetTimer) {
                node.status({ fill: "blue", shape: "ring", text: "waiting" });
            }
        }

        function showReceivedStatus(count) {
            clearStatusResetTimer();
            node.status({ fill: "green", shape: "dot", text: "received " + count });
            statusResetTimer = setTimeout(function () {
                statusResetTimer = null;
                setWaitingStatus();
            }, 2000);
        }

        function buildRequest() {
            var request = {
                queueId: settings.queueId,
                limit: settings.limit,
                timeoutInSeconds: settings.pollTimeoutSeconds
            };
            if (settings.visibilityInSeconds !== undefined) request.visibilityInSeconds = settings.visibilityInSeconds;
            if (settings.channelFilter) request.channelFilter = settings.channelFilter;
            if (settings.consumerGroupId) request.consumerGroupId = settings.consumerGroupId;
            return request;
        }

        async function poll() {
            while (!closing) {
                setWaitingStatus();
                try {
                    if (!client) client = await node.queueConfig.getClient(receiveController.signal);
                    if (closing) break;
                    var response = await client.getMessages(buildRequest());
                    if (closing) break;
                    var messages = response.getMessages && Array.isArray(response.getMessages.messages)
                        ? response.getMessages.messages
                        : [];
                    var deliveries = messages.map(function (message) {
                        return {
                            payload: queueSupport.parseContent(message.content),
                            statusCode: response.__httpStatusCode || 200,
                            ociQueue: {
                                queueOcid: settings.queueId,
                                id: message.id,
                                receipt: message.receipt,
                                deliveryCount: message.deliveryCount,
                                visibleAfter: message.visibleAfter,
                                expireAfter: message.expireAfter,
                                createdAt: message.createdAt,
                                metadata: message.metadata,
                                consumerGroupId: settings.consumerGroupId || null,
                                opcRequestId: response.opcRequestId || null
                            }
                        };
                    });
                    if (settings.outputMode === "batch" && deliveries.length) {
                        node.send({
                            payload: deliveries.map(function (delivery) { return delivery.payload; }),
                            statusCode: response.__httpStatusCode || 200,
                            ociQueue: {
                                queueOcid: settings.queueId,
                                consumerGroupId: settings.consumerGroupId || null,
                                opcRequestId: response.opcRequestId || null,
                                messageCount: deliveries.length,
                                records: deliveries.map(function (delivery) { return delivery.ociQueue; })
                            }
                        });
                    } else {
                        deliveries.forEach(function (delivery) { node.send(delivery); });
                    }
                    if (messages.length) {
                        showReceivedStatus(messages.length);
                    } else if (settings.pollTimeoutSeconds === 0) {
                        await waitForRetry();
                    }
                } catch (err) {
                    if (closing) break;
                    reportPollError(err);
                    await waitForRetry();
                }
            }
        }

        function reportPollError(err) {
            clearStatusResetTimer();
            var normalized = ociError.normalizeError(err);
            node.status({ fill: "red", shape: "dot", text: "receive failed" });
            var errorMsg = {
                error: { message: normalized.message, code: normalized.code },
                statusCode: normalized.statusCode,
                ociQueue: {
                    queueOcid: settings.queueId,
                    consumerGroupId: settings.consumerGroupId || null,
                    opcRequestId: normalized.opcRequestId || null
                }
            };
            node.error(normalized.message, errorMsg);
        }

        function waitForRetry() {
            if (closing) return Promise.resolve();
            return new Promise(function (resolve) {
                retryResolve = resolve;
                retryTimer = setTimeout(function () {
                    retryTimer = null;
                    retryResolve = null;
                    resolve();
                }, settings.retryDelayMs);
            });
        }

        startHandle = setImmediate(function () {
            startHandle = null;
            poll();
        });

        node.on("close", function (removed, done) {
            closing = true;
            receiveController.abort();
            if (startHandle) {
                clearImmediate(startHandle);
                startHandle = null;
            }
            if (retryTimer) {
                clearTimeout(retryTimer);
                retryTimer = null;
            }
            clearStatusResetTimer();
            if (retryResolve) {
                var resolve = retryResolve;
                retryResolve = null;
                resolve();
            }
            try {
                if (client && typeof client.shutdownCircuitBreaker === "function") {
                    client.shutdownCircuitBreaker();
                }
                node.status({});
                done();
            } catch (err) {
                done(err);
            }
        });
    }

    function readSettings(config) {
        var outputMode = config.outputMode === undefined ? "individual" : config.outputMode;
        if (outputMode !== "individual" && outputMode !== "batch") {
            throw queueSupport.validationError("Output Mode must be individual or batch");
        }
        return {
            outputMode: outputMode,
            limit: readInteger(config.limit, 10, 1, 20, "Limit"),
            pollTimeoutSeconds: readInteger(config.pollTimeoutSeconds, 20, 0, 30, "Poll Timeout"),
            visibilityInSeconds: config.visibilityInSeconds === "" || config.visibilityInSeconds === undefined
                ? undefined
                : readInteger(config.visibilityInSeconds, undefined, 0, 43200, "Visibility Timeout"),
            channelFilter: typeof config.channelFilter === "string" ? config.channelFilter.trim() : "",
            consumerGroupId: typeof config.consumerGroupId === "string" ? config.consumerGroupId.trim() : "",
            retryDelayMs: readInteger(config.retryDelayMs, 5000, 100, 300000, "Retry Delay")
        };
    }

    function readInteger(value, defaultValue, minimum, maximum, name) {
        var resolved = value === "" || value === undefined ? defaultValue : Number(value);
        if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
            throw queueSupport.validationError(name + " must be an integer from " + minimum + " to " + maximum);
        }
        return resolved;
    }

    RED.nodes.registerType("oci-queue-in", OciQueueInNode);
};

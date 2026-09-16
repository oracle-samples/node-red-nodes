/* Copyright (c) 2026 Oracle and/or its affiliates. Licensed under the UPL, Version 1.0. */

module.exports = function (RED) {
    var streamingSupport = require("../lib/oci-streaming.js");
    var ociError = require("../lib/oci-error.js");
    var performance = require("perf_hooks").performance;
    var GROUP_TIMEOUT_MS = 30000;
    var HEARTBEAT_INTERVAL_MS = 10000;
    // Leave headroom below OCI's five reads/second/partition/group limit.
    var MIN_READ_INTERVAL_MS = 210;
    var EMPTY_READ_DELAY_MS = 1000;

    function OciStreamingInNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        node.streamingConfig = RED.nodes.getNode(config.streamingConfig);

        if (!node.streamingConfig) {
            reportValidationError("No OCI Streaming Config configured", "no streaming config");
            return;
        }

        var settings;
        try {
            settings = readSettings(config, node.id);
        } catch (err) {
            reportValidationError(err.message, "invalid settings");
            return;
        }

        var closing = false;
        var halted = false;
        var hasJoined = false;
        var client = null;
        var streamOcid = null;
        var cursor = null;
        var pendingCommit = null;
        var committedOffsets = Object.create(null);
        var committedOnlyReads = 0;
        var startHandle = null;
        var retryHandle = null;
        var retryResolve = null;
        var statusResetTimer = null;
        var durableStatusText = "consuming";

        function validationError(message) {
            return streamingSupport.validationError(message);
        }

        function reportValidationError(message, statusText) {
            node.status({ fill: "red", shape: "ring", text: statusText });
            node.error(message, { error: { message: message, code: null } });
        }

        function cursorValue(response, operation) {
            var value = response && response.cursor && response.cursor.value;
            if (typeof value !== "string" || !value) {
                throw validationError(operation + " did not return a cursor");
            }
            return value;
        }

        function clearStatusResetTimer() {
            if (!statusResetTimer) return;
            clearTimeout(statusResetTimer);
            statusResetTimer = null;
        }

        function setDurableStatus(text) {
            durableStatusText = text;
            if (!closing && !statusResetTimer) {
                node.status({ fill: "blue", shape: "ring", text: text });
            }
        }

        function showReceivedStatus(count, nextStatus) {
            durableStatusText = nextStatus;
            clearStatusResetTimer();
            node.status({ fill: "green", shape: "dot", text: "received " + count });
            statusResetTimer = setTimeout(function () {
                statusResetTimer = null;
                if (!closing) {
                    node.status({ fill: "blue", shape: "ring", text: durableStatusText });
                }
            }, 2000);
        }

        function reportConsumerError(err) {
            clearStatusResetTimer();
            var safeError = streamingSupport.redactError(err, [
                cursor,
                pendingCommit && pendingCommit.cursor,
                pendingCommit && pendingCommit.token
            ]);
            var normalized = ociError.normalizeError(safeError);
            var errorMsg = {
                error: { message: normalized.message, code: normalized.code },
                statusCode: normalized.statusCode,
                ociStreaming: {
                    streamOcid: streamOcid,
                    consumerGroupId: settings.consumerGroupId,
                    instanceName: settings.instanceName
                }
            };
            if (normalized.opcRequestId) errorMsg.ociStreaming.opcRequestId = normalized.opcRequestId;
            node.status({ fill: "red", shape: err.isValidation ? "ring" : "dot", text: "consume failed" });
            node.error(normalized.message, errorMsg);
        }

        function waitBeforeRequest(delayMs) {
            if (closing) return Promise.resolve();
            return new Promise(function (resolve) {
                retryResolve = resolve;
                retryHandle = setTimeout(function () {
                    retryHandle = null;
                    retryResolve = null;
                    resolve();
                }, delayMs === undefined ? settings.retryDelayMs : delayMs);
            });
        }

        async function waitForReadSlot(lastReadStartedAt) {
            if (lastReadStartedAt === null) return;
            while (!closing) {
                var remaining = MIN_READ_INTERVAL_MS - (performance.now() - lastReadStartedAt);
                if (remaining <= 0) return;
                await waitBeforeRequest(Math.ceil(remaining));
            }
        }

        function recordMetadata(record, response) {
            return {
                streamOcid: streamOcid,
                stream: record.stream,
                partition: record.partition,
                offset: record.offset,
                key: streamingSupport.decodeText(record.key),
                timestamp: record.timestamp,
                consumerGroupId: settings.consumerGroupId,
                instanceName: settings.instanceName,
                opcRequestId: response.opcRequestId || null,
                autoCommit: settings.autoCommit
            };
        }

        function outputMessage(records, response) {
            var batch = settings.outputMode === "batch";
            var metadata = batch ? {
                streamOcid: streamOcid,
                consumerGroupId: settings.consumerGroupId,
                instanceName: settings.instanceName,
                autoCommit: settings.autoCommit,
                opcRequestId: response.opcRequestId || null,
                messageCount: records.length,
                records: records.map(function (record) { return recordMetadata(record, response); })
            } : recordMetadata(records[0], response);
            return {
                payload: batch
                    ? records.map(function (record) { return streamingSupport.decodeValue(record.value); })
                    : streamingSupport.decodeValue(records[0].value),
                statusCode: response.__httpStatusCode || 200,
                ociStreaming: metadata
            };
        }

        function emitAutomatic(records, response) {
            if (records.length) {
                if (settings.outputMode === "batch") {
                    node.send(outputMessage(records, response));
                } else {
                    records.forEach(function (record) { node.send(outputMessage([record], response)); });
                }
                showReceivedStatus(records.length, "consuming");
            }
        }

        function uncommittedRecords(records) {
            records.forEach(function (record) {
                if (typeof record.partition !== "string" || !record.partition ||
                    !Number.isSafeInteger(record.offset) || record.offset < 0) {
                    throw validationError("Manual Streaming records require a partition and a nonnegative safe integer offset");
                }
            });
            return records.filter(function (record) {
                var committed = committedOffsets[record.partition];
                return committed === undefined || record.offset > committed;
            });
        }

        async function heartbeatPendingMessage() {
            var entry = pendingCommit;
            if (!entry || entry.committing || closing) return;
            if (entry.heartbeatPromise) return entry.heartbeatPromise;
            entry.heartbeatPromise = (async function () {
                var response = await client.consumerHeartbeat({
                    streamId: streamOcid,
                    cursor: entry.cursor
                });
                if (pendingCommit === entry && !closing) {
                    entry.cursor = cursorValue(response, "ConsumerHeartbeat");
                }
            })();
            try {
                await entry.heartbeatPromise;
            } catch (err) {
                throw handleCursorFailure(err, entry);
            } finally {
                entry.heartbeatPromise = null;
            }
        }

        node.heartbeatPendingMessage = heartbeatPendingMessage;

        function beginHeartbeat(entry) {
            entry.heartbeatHandle = setInterval(function () {
                heartbeatPendingMessage().catch(function (err) {
                    if (!closing) {
                        reportConsumerError(err);
                    }
                });
            }, HEARTBEAT_INTERVAL_MS);
        }

        function releasePending(entry) {
            if (entry.heartbeatHandle) {
                clearInterval(entry.heartbeatHandle);
                entry.heartbeatHandle = null;
            }
            entry.resolve();
        }

        function handleCursorFailure(err, entry) {
            var safeError = streamingSupport.redactError(err, [cursor, entry && entry.cursor, entry && entry.token]);
            if (closing || (entry && pendingCommit !== entry)) return safeError;
            var normalized = ociError.normalizeError(err);
            if (normalized.statusCode !== 400) return safeError;
            var retentionLost = /outside.*retention|behind.*trim horizon/i.test(normalized.message);
            var cursorLost = /cursor.*expir|expir.*cursor|unreserved partition/i.test(normalized.message);
            if (!retentionLost && !cursorLost) return safeError;
            if (retentionLost) {
                halted = true;
                safeError.message += "; consumption stopped: administrator must review retention loss and reset the group position before redeploying";
            }
            cursor = null;
            committedOnlyReads = 0;
            if (pendingCommit) {
                var pending = pendingCommit;
                pendingCommit = null;
                releasePending(pending);
            }
            return safeError;
        }

        async function emitManual(records, response, nextCursor) {
            var outMsg = outputMessage(records, response);
            var token = RED.util.generateId();
            var waitForCommit = new Promise(function (resolve) {
                pendingCommit = {
                    token: token,
                    cursor: nextCursor,
                    records: records.map(function (record) {
                        return { partition: record.partition, offset: record.offset };
                    }),
                    committing: false,
                    heartbeatHandle: null,
                    heartbeatPromise: null,
                    resolve: resolve
                };
            });
            outMsg.ociStreaming.consumerNodeId = node.id;
            outMsg.ociStreaming.commitToken = token;
            beginHeartbeat(pendingCommit);
            showReceivedStatus(records.length, "awaiting commit");
            node.send(outMsg);
            await waitForCommit;
        }

        node.commitMessage = async function (token) {
            if (closing) throw validationError("Streaming In is not active");
            if (settings.autoCommit) throw validationError("Streaming In uses automatic commits");
            if (typeof token !== "string" || !token) {
                throw validationError("OCI Streaming commit token is required");
            }
            var entry = pendingCommit;
            if (!entry || entry.token !== token) {
                throw validationError("OCI Streaming commit token is stale or already committed");
            }
            if (entry.committing) throw validationError("OCI Streaming commit is already in progress");

            entry.committing = true;
            try {
                if (entry.heartbeatPromise) {
                    try {
                        await entry.heartbeatPromise;
                    } catch (heartbeatErr) {
                        // The commit can still use the last cursor confirmed by OCI.
                    }
                }
                if (closing || pendingCommit !== entry) {
                    throw validationError("Streaming In is not active or the commit token is stale");
                }
                var response = await client.consumerCommit({
                    streamId: streamOcid,
                    cursor: entry.cursor
                });
                if (closing || pendingCommit !== entry) {
                    throw validationError("Streaming In is not active or the commit token is stale");
                }
                cursor = cursorValue(response, "ConsumerCommit");
                entry.records.forEach(function (record) {
                    var previous = committedOffsets[record.partition];
                    committedOffsets[record.partition] = previous === undefined
                        ? record.offset : Math.max(previous, record.offset);
                });
                pendingCommit = null;
                releasePending(entry);
                var result = settings.outputMode === "batch"
                    ? { messageCount: entry.records.length }
                    : { partition: entry.records[0].partition, offset: entry.records[0].offset };
                result.opcRequestId = response.opcRequestId || null;
                return result;
            } catch (err) {
                entry.committing = false;
                var safeError = handleCursorFailure(err, entry);
                if (halted) reportConsumerError(safeError);
                throw safeError;
            }
        };

        async function consume() {
            var lastReadStartedAt = null;
            while (!closing && !halted) {
                try {
                    if (!cursor) {
                        node.status({ fill: "blue", shape: "dot", text: "connecting" });
                        client = await node.streamingConfig.getClient();
                        if (closing) return;
                        streamOcid = node.streamingConfig.getStreamOcid();
                        var response = await client.createGroupCursor({
                            streamId: streamOcid,
                            createGroupCursorDetails: {
                                // Existing groups keep their offsets; an expired group recovers retained records.
                                type: hasJoined ? "TRIM_HORIZON" : settings.cursorType,
                                groupName: settings.consumerGroupId,
                                instanceName: settings.instanceName,
                                timeoutInMs: GROUP_TIMEOUT_MS,
                                commitOnGet: settings.autoCommit
                            }
                        });
                        if (closing) return;
                        cursor = cursorValue(response, "CreateGroupCursor");
                        hasJoined = true;
                        setDurableStatus("consuming");
                    }
                    await waitForReadSlot(lastReadStartedAt);
                    if (closing) return;
                    lastReadStartedAt = performance.now();
                    var messagesResponse = await client.getMessages({
                        streamId: streamOcid,
                        cursor: cursor,
                        limit: settings.autoCommit || settings.outputMode === "batch" ? settings.batchLimit : 1
                    });
                    if (closing) return;
                    if (typeof messagesResponse.opcNextCursor !== "string" || !messagesResponse.opcNextCursor) {
                        throw validationError("GetMessages did not return a next cursor");
                    }
                    var records = Array.isArray(messagesResponse.items) ? messagesResponse.items : [];
                    if (!settings.autoCommit && records.length) {
                        if (settings.outputMode === "individual" && records.length > 1) {
                            throw validationError("Manual Individual read returned more than one record");
                        }
                        records = uncommittedRecords(records);
                        if (!records.length) {
                            // Follow the read cursor past records already confirmed by ConsumerCommit.
                            cursor = messagesResponse.opcNextCursor;
                            committedOnlyReads = Math.min(committedOnlyReads + 1, 6);
                            if (committedOnlyReads === 5) {
                                reportConsumerError(new Error("Streaming repeatedly returned only committed records; check consumer group state before restarting"));
                            }
                            await waitBeforeRequest(EMPTY_READ_DELAY_MS);
                            continue;
                        }
                    }
                    if (committedOnlyReads) setDurableStatus("consuming");
                    committedOnlyReads = 0;
                    if (settings.autoCommit) {
                        cursor = messagesResponse.opcNextCursor;
                        emitAutomatic(records, messagesResponse);
                    } else if (records.length) {
                        await emitManual(records, messagesResponse, messagesResponse.opcNextCursor);
                        if (closing || halted) return;
                        if (!cursor) await waitBeforeRequest();
                        setDurableStatus("consuming");
                    } else {
                        cursor = messagesResponse.opcNextCursor;
                    }
                    if (!records.length) await waitBeforeRequest(EMPTY_READ_DELAY_MS);
                } catch (err) {
                    if (closing) return;
                    reportConsumerError(handleCursorFailure(err));
                    if (halted) return;
                    await waitBeforeRequest();
                    if (!closing) setDurableStatus("consuming");
                }
            }
        }

        startHandle = setImmediate(function () {
            startHandle = null;
            consume().catch(function (err) {
                if (!closing) reportConsumerError(err);
            });
        });

        node.on("close", function (removed, done) {
            closing = true;
            if (startHandle) {
                clearImmediate(startHandle);
                startHandle = null;
            }
            clearStatusResetTimer();
            if (retryHandle) {
                clearTimeout(retryHandle);
                retryHandle = null;
            }
            if (retryResolve) {
                var resolveRetry = retryResolve;
                retryResolve = null;
                resolveRetry();
            }
            if (pendingCommit) {
                var entry = pendingCommit;
                pendingCommit = null;
                releasePending(entry);
            }
            node.status({});
            done();
        });
    }

    function readSettings(config, nodeId) {
        var consumerGroupId = typeof config.consumerGroupId === "string"
            ? config.consumerGroupId.trim()
            : "";
        if (!consumerGroupId) throw streamingSupport.validationError("Consumer Group ID is required");

        var instanceName = typeof config.instanceName === "string"
            ? config.instanceName.trim()
            : "";
        if (!instanceName) instanceName = "node-red-" + nodeId;

        var startPosition = config.startPosition || "latest";
        if (startPosition !== "latest" && startPosition !== "beginning") {
            throw streamingSupport.validationError("Start Position must be Latest or Beginning");
        }
        var outputMode = config.outputMode || "individual";
        if (outputMode !== "individual" && outputMode !== "batch") {
            throw streamingSupport.validationError("Output Mode must be Individual or Batch array");
        }

        return {
            outputMode: outputMode,
            consumerGroupId: consumerGroupId,
            instanceName: instanceName,
            cursorType: startPosition === "beginning" ? "TRIM_HORIZON" : "LATEST",
            batchLimit: streamingSupport.readInteger(config.batchLimit, 10, 1, 10000, "Batch Limit"),
            autoCommit: config.autoCommit !== false && config.autoCommit !== "false",
            retryDelayMs: streamingSupport.readInteger(config.retryDelayMs, 1000, 100, 300000, "Retry Delay")
        };
    }

    RED.nodes.registerType("oci-streaming-in", OciStreamingInNode);
};

/* Copyright (c) 2026 Oracle and/or its affiliates. Licensed under the UPL, Version 1.0. */

module.exports = function (RED) {
    var kafkaSupport = require("../lib/oci-kafka.js");
    var ociError = require("../lib/oci-error.js");
    var kafkaErrorCodes = require("@confluentinc/kafka-javascript").KafkaJS.ErrorCodes;

    function OciKafkaConsumerNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.kafkaConfig = RED.nodes.getNode(config.kafkaConfig);
        if (!node.kafkaConfig) {
            reportValidationError("No Kafka Config configured", "no Kafka config");
            return;
        }

        var settings;
        try {
            settings = readSettings(config);
        } catch (err) {
            reportValidationError(err.message, "invalid settings");
            return;
        }

        var closing = false;
        var consumer = null;
        var startHandle = null;
        var startPromise = null;
        var pendingCommits = {};
        var statusResetTimer = null;
        var durableStatusText = "consuming";

        function reportValidationError(message, statusText) {
            var errorMsg = {
                error: { message: message, code: null }
            };
            node.status({ fill: "red", shape: "ring", text: statusText });
            node.error(message, errorMsg);
        }

        function decodeHeaders(headers) {
            if (!headers || typeof headers !== "object") return headers;
            var decoded = {};
            Object.keys(headers).forEach(function (name) {
                var value = headers[name];
                decoded[name] = Array.isArray(value)
                    ? value.map(kafkaSupport.decodeText)
                    : kafkaSupport.decodeText(value);
            });
            return decoded;
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

        function nextOffset(value) {
            try {
                if (!/^\d+$/.test(String(value))) throw new Error();
                var offset = BigInt(value);
                if (offset < 0 || offset >= BigInt(Number.MAX_SAFE_INTEGER)) throw new Error();
                return String(offset + 1n);
            } catch (err) {
                var validation = new Error("Kafka record and next offsets must be non-negative safe integers within the native client's safe integer range");
                validation.isValidation = true;
                throw validation;
            }
        }

        function updatePendingStatus() {
            setDurableStatus(Object.keys(pendingCommits).length ? "awaiting commit" : "consuming");
        }

        function onRebalance(err, assignment, assignmentFns) {
            var lost = assignmentFns && assignmentFns.assignmentLost();
            var knownEvent = err.code === kafkaErrorCodes.ERR__ASSIGN_PARTITIONS || err.code === kafkaErrorCodes.ERR__REVOKE_PARTITIONS;
            Object.keys(pendingCommits).forEach(function (token) {
                var entry = pendingCommits[token];
                var affected = lost || !knownEvent || !assignment || assignment.some(function (partition) {
                    return partition.topic === entry.topic && partition.partition === entry.partition;
                });
                if (!affected) return;
                delete pendingCommits[token];
                if (entry.dispatchHandle) clearImmediate(entry.dispatchHandle);
                // The native client retains pause state across assignments; discard the old owner's pause.
                if (!closing && entry.resume) consumer.resume([{ topic: entry.topic, partitions: [entry.partition] }]);
            });
            updatePendingStatus();
        }

        node.commitMessage = async function (token) {
            if (closing) throw validationError("Kafka Consumer is not active");
            if (settings.autoCommit) throw validationError("Kafka Consumer uses automatic commits");
            if (typeof token !== "string" || !token) throw validationError("Kafka commit token is required");

            var entry = pendingCommits[token];
            if (!entry) throw validationError("Kafka commit token is stale or already committed");
            if (entry.dispatchHandle) throw validationError("Kafka batch has not been emitted");
            if (entry.committing) throw validationError("Kafka commit is already in progress");

            entry.committing = true;
            try {
                await consumer.commitOffsets([{
                    topic: entry.topic,
                    partition: entry.partition,
                    offset: entry.nextOffset
                }]);
                if (closing || pendingCommits[token] !== entry) {
                    throw validationError("Kafka commit token is stale or its Consumer is not active");
                }
                entry.resume();
                delete pendingCommits[token];
                updatePendingStatus();
                var result = {
                    topic: entry.topic,
                    partition: entry.partition,
                    nextOffset: entry.nextOffset
                };
                if (entry.messageCount) result.messageCount = entry.messageCount;
                else result.offset = entry.offset;
                return result;
            } catch (err) {
                entry.committing = false;
                throw typeof node.kafkaConfig.sanitizeError === "function"
                    ? node.kafkaConfig.sanitizeError(err)
                    : err;
            }
        };

        function validationError(message) {
            var err = new Error(message);
            err.isValidation = true;
            return err;
        }

        async function emitRecord(record) {
            var offsetToCommit;
            try {
                offsetToCommit = nextOffset(record.message.offset);
            } catch (err) {
                consumer.pause([{ topic: record.topic, partitions: [record.partition] }]);
                reportConsumerError(err);
                throw err;
            }
            var kafka = {
                topic: record.topic,
                partition: record.partition,
                offset: record.message.offset,
                key: kafkaSupport.decodeText(record.message.key),
                headers: decodeHeaders(record.message.headers),
                timestamp: record.message.timestamp,
                consumerGroupId: settings.consumerGroupId,
                autoCommit: settings.autoCommit
            };

            if (settings.autoCommit) {
                node.send({
                    payload: kafkaSupport.decodeValue(record.message.value),
                    kafka: kafka
                });
                showReceivedStatus(1, "consuming");
                return;
            }

            var token = RED.util.generateId();
            pendingCommits[token] = {
                topic: record.topic,
                partition: record.partition,
                offset: record.message.offset,
                nextOffset: offsetToCommit,
                committing: false,
                resume: consumer.pause([{ topic: record.topic, partitions: [record.partition] }])
            };
            kafka.consumerNodeId = node.id;
            kafka.commitToken = token;
            node.send({
                payload: kafkaSupport.decodeValue(record.message.value),
                kafka: kafka
            });
            showReceivedStatus(1, "awaiting commit");
        }

        async function emitBatch(delivery) {
            if (closing || !delivery.isRunning() || delivery.isStale()) return;
            var batch = delivery.batch;
            if (!batch.messages.length) return;
            try {
                if (batch.messages.length > settings.batchLimit) {
                    throw validationError("Kafka batch exceeds Batch Limit");
                }
                var pendingToken = Object.keys(pendingCommits).find(function (token) {
                    var entry = pendingCommits[token];
                    return entry.topic === batch.topic && entry.partition === batch.partition;
                });
                if (pendingToken) {
                    pauseBatch(pendingCommits[pendingToken]);
                    return;
                }
                var payload = [];
                var records = [];
                var offsetToCommit;
                var previousOffset = -1n;
                batch.messages.forEach(function (message) {
                    offsetToCommit = nextOffset(message.offset);
                    var offset = BigInt(message.offset);
                    if (offset <= previousOffset) throw validationError("Kafka batch offsets must be in increasing order");
                    previousOffset = offset;
                    payload.push(kafkaSupport.decodeValue(message.value));
                    records.push({
                        topic: batch.topic,
                        partition: batch.partition,
                        offset: message.offset,
                        key: kafkaSupport.decodeText(message.key),
                        headers: decodeHeaders(message.headers),
                        timestamp: message.timestamp
                    });
                });
                var kafka = {
                    topic: batch.topic,
                    partition: batch.partition,
                    consumerGroupId: settings.consumerGroupId,
                    autoCommit: settings.autoCommit,
                    messageCount: records.length,
                    records: records
                };
                if (!settings.autoCommit) {
                    var token = RED.util.generateId();
                    var entry = {
                        topic: batch.topic,
                        partition: batch.partition,
                        nextOffset: offsetToCommit,
                        messageCount: records.length,
                        committing: false,
                        resume: null,
                        dispatchHandle: null
                    };
                    pendingCommits[token] = entry;
                    kafka.consumerNodeId = node.id;
                    kafka.commitToken = token;
                    // Give the native fetcher one turn to grow its bounded cache before pause resets fetch statistics.
                    entry.dispatchHandle = setImmediate(function () {
                        entry.dispatchHandle = null;
                        if (closing || pendingCommits[token] !== entry) return;
                        try {
                            pauseBatch(entry);
                            node.send({ payload: payload, kafka: kafka });
                            showReceivedStatus(records.length, "awaiting commit");
                        } catch (err) {
                            delete pendingCommits[token];
                            reportConsumerError(err);
                        }
                    });
                } else {
                    node.send({ payload: payload, kafka: kafka });
                    showReceivedStatus(records.length, "consuming");
                }
                var last = batch.messages[batch.messages.length - 1];
                // Manual mode stores only the local read position; Kafka Commit persists the broker offset.
                delivery.resolveOffset(last.offset, last.leaderEpoch);
            } catch (err) {
                if (token && pendingCommits[token]) {
                    clearImmediate(pendingCommits[token].dispatchHandle);
                    delete pendingCommits[token];
                }
                consumer.pause([{ topic: batch.topic, partitions: [batch.partition] }]);
                reportConsumerError(err);
                throw err;
            }
        }

        function pauseBatch(entry) {
            if (!entry.resume) entry.resume = consumer.pause([{ topic: entry.topic, partitions: [entry.partition] }]);
        }

        async function start() {
            node.status({ fill: "blue", shape: "dot", text: "connecting" });
            try {
                consumer = node.kafkaConfig.createConsumer({
                    groupId: settings.consumerGroupId,
                    fromBeginning: settings.fromBeginning,
                    autoCommit: settings.autoCommit,
                    allowAutoTopicCreation: false
                }, onRebalance, settings.outputMode === "batch" ? settings.batchLimit : undefined);
                await consumer.connect();
                if (closing) return;
                await consumer.subscribe({
                    topic: settings.topic
                });
                if (closing) return;
                var runOptions = settings.outputMode === "batch" ? {
                    eachBatchAutoResolve: false,
                    eachBatch: emitBatch
                } : {
                    eachMessage: async function (record) {
                        if (closing) return;
                        await emitRecord(record);
                    }
                };
                await consumer.run(runOptions);
                setDurableStatus("consuming");
            } catch (err) {
                if (consumer) {
                    var failedConsumer = consumer;
                    consumer = null;
                    try {
                        await failedConsumer.disconnect();
                    } catch (disconnectErr) {
                        // The original startup error is the actionable failure.
                    }
                }
                if (!closing) reportConsumerError(err);
            }
        }

        function reportConsumerError(err) {
            clearStatusResetTimer();
            var safeError = typeof node.kafkaConfig.sanitizeError === "function"
                ? node.kafkaConfig.sanitizeError(err)
                : err;
            var normalized = ociError.normalizeError(safeError);
            var errorMsg = {
                error: { message: normalized.message, code: normalized.code },
                kafka: {
                    topic: settings.topic,
                    consumerGroupId: settings.consumerGroupId
                }
            };
            node.status({ fill: "red", shape: "dot", text: "consume failed" });
            node.error(normalized.message, errorMsg);
        }

        startHandle = setImmediate(function () {
            startHandle = null;
            startPromise = start();
        });

        node.on("close", async function (removed, done) {
            closing = true;
            clearStatusResetTimer();
            if (startHandle) {
                clearImmediate(startHandle);
                startHandle = null;
            }
            Object.keys(pendingCommits).forEach(function (token) {
                if (pendingCommits[token].dispatchHandle) clearImmediate(pendingCommits[token].dispatchHandle);
                delete pendingCommits[token];
            });
            try {
                if (consumer) {
                    var current = consumer;
                    consumer = null;
                    await current.disconnect();
                }
                if (startPromise) await startPromise;
                node.status({});
                done();
            } catch (err) {
                done(err);
            }
        });
    }

    function readSettings(config) {
        var topic = typeof config.topic === "string" ? config.topic.trim() : "";
        var consumerGroupId = typeof config.consumerGroupId === "string"
            ? config.consumerGroupId.trim()
            : "";
        if (!topic) throw new Error("Kafka Topic is required");
        if (!consumerGroupId) throw new Error("Consumer Group ID is required");
        var outputMode = config.outputMode === undefined ? "individual" : config.outputMode;
        if (outputMode !== "individual" && outputMode !== "batch") throw new Error("Output Mode must be Individual or Batch array");
        var batchLimit = config.batchLimit === undefined ? 32 : Number(config.batchLimit);
        if (outputMode === "batch" && (!Number.isInteger(batchLimit) || batchLimit < 1 || batchLimit > 2147483647)) {
            throw new Error("Batch Limit must be an integer between 1 and 2147483647");
        }
        return {
            topic: topic,
            consumerGroupId: consumerGroupId,
            outputMode: outputMode,
            batchLimit: batchLimit,
            fromBeginning: config.fromBeginning === true || config.fromBeginning === "true",
            autoCommit: config.autoCommit !== false && config.autoCommit !== "false"
        };
    }

    RED.nodes.registerType("oci-kafka-consumer", OciKafkaConsumerNode);
};

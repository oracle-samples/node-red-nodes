/* Copyright (c) 2026 Oracle and/or its affiliates. Licensed under the UPL, Version 1.0. */

module.exports = function (RED) {
    var queueSupport = require("../lib/oci-queue.js");
    var ociError = require("../lib/oci-error.js");

    function OciQueueAckNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        node.queueConfig = RED.nodes.getNode(config.queueConfig);
        if (!node.queueConfig) {
            node.status({ fill: "red", shape: "ring", text: "no Queue config" });
            node.error("No OCI Queue Config configured");
            return;
        }

        node.on("input", async function (msg, send, done) {
            var receipts = [];
            try {
                var input = msg.ociQueue && typeof msg.ociQueue === "object" && !Array.isArray(msg.ociQueue)
                    ? msg.ociQueue
                    : {};
                var batch = Object.prototype.hasOwnProperty.call(input, "records");
                receipts = batch && Array.isArray(input.records)
                    ? input.records.map(function (record) { return record && record.receipt; })
                    : [input.receipt];
                var queueId = node.queueConfig.getQueueOcid();
                if (batch) {
                    msg.ociQueue = input = Object.assign({}, input, { acknowledged: false });
                    delete input.ackResults;
                    delete input.acknowledgedCount;
                    delete input.failedCount;
                    validateBatch(msg, input, queueId);
                } else if (typeof input.receipt !== "string" || !input.receipt) {
                    throw queueSupport.validationError("msg.ociQueue.receipt is required");
                }
                var request = { queueId: queueId };
                if (batch) request.deleteMessagesDetails = { entries: receipts.map(function (receipt) { return { receipt: receipt }; }) };
                else request.messageReceipt = input.receipt;
                if (typeof input.consumerGroupId === "string" && input.consumerGroupId) {
                    request.consumerGroupId = input.consumerGroupId;
                }
                if (typeof input.ackOpcRequestId === "string" && input.ackOpcRequestId) {
                    request.opcRequestId = input.ackOpcRequestId;
                }

                node.status({ fill: "yellow", shape: "dot", text: "acknowledging" });
                var client = await node.queueConfig.getClient();
                var response = batch ? await client.deleteMessages(request) : await client.deleteMessage(request);
                if (batch) {
                    var results = readBatchResult(response.deleteMessagesResult, receipts);
                    msg.ociQueue = input = Object.assign({}, input, results, {
                        opcRequestId: response.opcRequestId || input.ackOpcRequestId || null
                    });
                    if (results.failedCount) {
                        var partialError = new Error("Queue batch acknowledgement partially failed; inspect msg.ociQueue.ackResults");
                        partialError.code = "PartialAcknowledgement";
                        partialError.statusCode = response.__httpStatusCode || 200;
                        partialError.opcRequestId = response.opcRequestId;
                        throw partialError;
                    }
                }
                var outMsg = Object.assign({}, msg, {
                    statusCode: response.__httpStatusCode || 204,
                    ociQueue: Object.assign({}, input, {
                        queueOcid: request.queueId,
                        acknowledged: true,
                        opcRequestId: response.opcRequestId || input.ackOpcRequestId || null
                    })
                });
                queueSupport.reattachTransaction(msg, outMsg);
                node.status({ fill: "green", shape: "dot", text: "acknowledged" });
                send(outMsg);
                done();
            } catch (err) {
                var safeError = redactReceipts(err, receipts);
                ociError.handleNodeError(node, msg, safeError, done, {
                    statusText: "acknowledge failed",
                    statusShape: err.isValidation ? "ring" : "dot",
                    setPayload: false
                });
            }
        });
    }

    function validateBatch(msg, input, queueId) {
        var records = input.records;
        if (!Array.isArray(records) || records.length < 1 || records.length > 20 ||
            !Array.isArray(msg.payload) || msg.payload.length !== records.length || input.messageCount !== records.length) {
            throw queueSupport.validationError("Batch payload, records and messageCount must match and contain 1 to 20 messages");
        }
        if (input.queueOcid !== queueId) throw queueSupport.validationError("Batch queue does not match Queue Config");
        var seen = new Set();
        records.forEach(function (record) {
            if (!record || typeof record.receipt !== "string" || !record.receipt.trim() || seen.has(record.receipt)) {
                throw queueSupport.validationError("Batch records require distinct non-empty receipts");
            }
            if (record.queueOcid !== undefined && record.queueOcid !== queueId) {
                throw queueSupport.validationError("Batch record queue does not match Queue Config");
            }
            if (record.consumerGroupId !== undefined && record.consumerGroupId !== input.consumerGroupId) {
                throw queueSupport.validationError("Batch record consumer group does not match batch consumer group");
            }
            seen.add(record.receipt);
        });
    }

    function readBatchResult(result, receipts) {
        function invalidResult() {
            var err = new Error("Invalid Queue batch acknowledgement response; deletion outcomes are unknown");
            err.code = "InvalidResponse";
            return err;
        }
        if (!result || !Array.isArray(result.entries) || result.entries.length !== receipts.length ||
            !Number.isInteger(result.serverFailures) || result.serverFailures < 0 ||
            !Number.isInteger(result.clientFailures) || result.clientFailures < 0) throw invalidResult();
        var failedCount = 0;
        var ackResults = result.entries.map(function (entry, index) {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw invalidResult();
            if ((entry.errorCode !== undefined && !Number.isInteger(entry.errorCode)) ||
                (entry.errorMessage !== undefined && typeof entry.errorMessage !== "string")) throw invalidResult();
            var failed = entry.errorCode !== undefined || entry.errorMessage !== undefined;
            if (failed) failedCount++;
            var output = { index: index, acknowledged: !failed };
            if (failed) {
                output.errorCode = entry.errorCode;
                output.errorMessage = redactText(String(entry.errorMessage || "Acknowledgement failed"), receipts);
            }
            return output;
        });
        if (failedCount !== result.serverFailures + result.clientFailures) throw invalidResult();
        return { ackResults: ackResults, acknowledgedCount: receipts.length - failedCount, failedCount: failedCount };
    }

    function redactText(text, receipts) {
        receipts.filter(function (receipt) { return typeof receipt === "string" && receipt; })
            .sort(function (a, b) { return b.length - a.length; })
            .forEach(function (receipt) { text = text.split(receipt).join("[redacted]"); });
        return text;
    }

    function redactReceipts(err, receipts) {
        var normalized = ociError.normalizeError(err);
        var safe = new Error(redactText(normalized.message, receipts));
        safe.code = normalized.code;
        safe.statusCode = normalized.statusCode;
        safe.opcRequestId = normalized.opcRequestId;
        return safe;
    }

    RED.nodes.registerType("oci-queue-ack", OciQueueAckNode);
};

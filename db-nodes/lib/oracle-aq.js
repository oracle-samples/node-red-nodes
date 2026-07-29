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

var DEFAULT_RETRY_DELAY_MS = 5000;

function normalizePayloadType(value) {
    var type = String(value || "json").toLowerCase();
    if (type === "raw" || type === "adt") return type;
    return "json";
}

function resolveQueuePayloadType(oracledb, payloadType, adtTypeName) {
    var type = normalizePayloadType(payloadType);
    if (type === "adt") return String(adtTypeName || "").toUpperCase();
    if (type === "raw") return oracledb.DB_TYPE_RAW;
    return oracledb.DB_TYPE_JSON;
}

function resolveDeliveryMode(oracledb, value) {
    return value === "buffered"
        ? oracledb.AQ_MSG_DELIV_MODE_BUFFERED
        : oracledb.AQ_MSG_DELIV_MODE_PERSISTENT;
}

function resolveDequeueMode(oracledb, value) {
    if (value === "browse") return oracledb.AQ_DEQ_MODE_BROWSE;
    if (value === "locked") return oracledb.AQ_DEQ_MODE_LOCKED;
    return oracledb.AQ_DEQ_MODE_REMOVE;
}

function normalizeEnqueuePayload(payloadType, configuredPayload, msgPayload) {
    var type = normalizePayloadType(payloadType);
    var payload;

    if (type === "raw") {
        payload = configuredPayload && String(configuredPayload).trim()
            ? configuredPayload
            : msgPayload;
    } else {
        payload = configuredPayload && String(configuredPayload).trim()
            ? JSON.parse(configuredPayload)
            : msgPayload;
    }

    return Array.isArray(payload) ? payload : [payload];
}

function createEnqueueMessages(payloadType, queue, payloads) {
    var type = normalizePayloadType(payloadType);
    if (type === "adt") {
        return payloads.map(function (item) {
            return { payload: new queue.payloadTypeClass(item) };
        });
    }
    if (type === "raw") {
        return payloads.map(function (item) {
            return { payload: Buffer.isBuffer(item) ? item : Buffer.from(String(item)) };
        });
    }
    return payloads.map(function (item) {
        return { payload: item };
    });
}

function dbObjectToPojo(obj) {
    if (obj && obj._objType && obj._objType.attributes) {
        var result = {};
        for (var i = 0; i < obj._objType.attributes.length; i++) {
            var attr = obj._objType.attributes[i];
            var val = obj[attr.name];
            result[attr.name] = (val && val._objType && val._objType.attributes)
                ? dbObjectToPojo(val)
                : val;
        }
        return result;
    }
    return obj;
}

function configureEnqueueQueue(queue, oracledb, config) {
    queue.enqOptions.deliveryMode = resolveDeliveryMode(oracledb, config.deliveryMode);
    if (config.recipients) {
        queue.enqOptions.recipients = config.recipients;
    }
}

function configureDequeueQueue(queue, oracledb, config) {
    if (config.subscriber) queue.deqOptions.consumerName = config.subscriber;
    queue.deqOptions.mode = resolveDequeueMode(oracledb, config.deqMode);
    queue.deqOptions.visibility = oracledb.AQ_VISIBILITY_ON_COMMIT;
    queue.deqOptions.wait = config.waitForever
        ? oracledb.AQ_DEQ_WAIT_FOREVER
        : config.wait;
}

var MAX_BATCH_SIZE = 10000;

function normalizeBatchSize(value) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return Math.min(Math.floor(parsed), MAX_BATCH_SIZE);
}

function normalizeWait(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeRetryDelay(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_RETRY_DELAY_MS;
}

function normalizeMaxRetries(value) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.floor(parsed);
}

function isMissingConsumerNameError(err) {
    if (!err) return false;
    if (err.errorNum === 25231) return true;
    if (String(err.code || "").toUpperCase() === "ORA-25231") return true;
    return String(err.message || err).toUpperCase().indexOf("ORA-25231") !== -1;
}

function nextRetryAttempt(currentAttempt, retryEnabled, maxRetries) {
    var attempt = Number(currentAttempt) + 1;
    if (!Number.isFinite(attempt) || attempt < 1) attempt = 1;
    return {
        attempt: attempt,
        shouldRetry: !!retryEnabled && (maxRetries === 0 || attempt <= maxRetries)
    };
}

module.exports = {
    DEFAULT_RETRY_DELAY_MS: DEFAULT_RETRY_DELAY_MS,
    normalizePayloadType: normalizePayloadType,
    resolveQueuePayloadType: resolveQueuePayloadType,
    resolveDeliveryMode: resolveDeliveryMode,
    resolveDequeueMode: resolveDequeueMode,
    normalizeEnqueuePayload: normalizeEnqueuePayload,
    createEnqueueMessages: createEnqueueMessages,
    dbObjectToPojo: dbObjectToPojo,
    configureEnqueueQueue: configureEnqueueQueue,
    configureDequeueQueue: configureDequeueQueue,
    MAX_BATCH_SIZE: MAX_BATCH_SIZE,
    normalizeBatchSize: normalizeBatchSize,
    normalizeWait: normalizeWait,
    normalizeRetryDelay: normalizeRetryDelay,
    normalizeMaxRetries: normalizeMaxRetries,
    isMissingConsumerNameError: isMissingConsumerNameError,
    nextRetryAttempt: nextRetryAttempt
};

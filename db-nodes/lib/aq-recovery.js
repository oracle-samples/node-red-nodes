/* Copyright (c) 2026 Oracle and/or its affiliates.
 * Licensed under the Universal Permissive License (UPL), Version 1.0.
 * https://oss.oracle.com/licenses/upl/
 */

function failure(code, message) {
    var err = new Error(message);
    err.code = code;
    return err;
}

function validateJson(value, ancestors) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object" || Buffer.isBuffer(value)) throw new Error("Unsupported JSON value");
    var proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== null &&
        (!Object.prototype.hasOwnProperty.call(proto, "constructor") || proto.constructor.name !== "Object")) {
        throw new Error("Unsupported JSON object");
    }
    var conversion = Object.getOwnPropertyDescriptor(value, "toJSON");
    if ((conversion && (!Object.prototype.hasOwnProperty.call(conversion, "value") || typeof conversion.value === "function")) ||
        Object.getOwnPropertySymbols(value).length) {
        throw new Error("Unsupported JSON conversion");
    }
    if (ancestors.has(value)) throw new Error("Circular JSON value");
    ancestors.add(value);
    if (Array.isArray(value)) {
        if (Object.keys(value).length !== value.length) throw new Error("Non-JSON array properties");
        for (var i = 0; i < value.length; i++) {
            var item = Object.getOwnPropertyDescriptor(value, i);
            if (!item || !Object.prototype.hasOwnProperty.call(item, "value")) throw new Error("Sparse JSON array or accessor");
            validateJson(item.value, ancestors);
        }
    } else {
        Object.keys(value).forEach(function (key) {
            var descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!Object.prototype.hasOwnProperty.call(descriptor, "value")) throw new Error("JSON accessor");
            validateJson(descriptor.value, ancestors);
        });
    }
    ancestors.delete(value);
}

function checkType(payloadType) {
    if (payloadType !== "json" && payloadType !== "raw") {
        throw failure("AQ_RECOVERY_TYPE_UNSUPPORTED", "Original payload recovery supports JSON and RAW queues only");
    }
}

function capture(payload, payloadType) {
    checkType(payloadType);
    try {
        if (payloadType === "raw") {
            if (!Buffer.isBuffer(payload)) throw new Error("RAW buffer required");
            return "aq1:raw:" + payload.toString("base64");
        }
        validateJson(payload, new Set());
        // A string shares safely across message clones without a global cache or expiry.
        return "aq1:json:" + JSON.stringify(payload);
    } catch (err) {
        throw failure("AQ_RECOVERY_PAYLOAD_UNSUPPORTED", "Original payload cannot be retained losslessly; JSON must contain plain JSON values and RAW must be a Buffer");
    }
}

function restore(snapshot, payloadType) {
    checkType(payloadType);
    if (snapshot === undefined || snapshot === null) {
        throw failure("AQ_RECOVERY_UNAVAILABLE", "No retained original payload; enable Retain Original on Dequeue and preserve message properties");
    }
    if (typeof snapshot !== "string" || !/^aq1:(json|raw):/.test(snapshot)) {
        throw failure("AQ_RECOVERY_INVALID", "Invalid retained original payload");
    }
    var prefix = "aq1:" + payloadType + ":";
    if (!snapshot.startsWith(prefix)) {
        throw failure("AQ_RECOVERY_TYPE_MISMATCH", "Retained original payload type does not match the destination queue payload type");
    }
    try {
        var content = snapshot.slice(prefix.length);
        if (payloadType === "raw") {
            var buffer = Buffer.from(content, "base64");
            if (buffer.toString("base64") !== content) throw new Error("Invalid RAW encoding");
            return buffer;
        }
        var payload = JSON.parse(content);
        validateJson(payload, new Set());
        return payload;
    } catch (err) {
        throw failure("AQ_RECOVERY_INVALID", "Invalid retained original payload");
    }
}

function restoreMessage(msg, payloadType) {
    checkType(payloadType);
    var has = function (key) { return Object.prototype.hasOwnProperty.call(msg, key); };
    if (has("_aqOriginalsIncomplete")) {
        throw failure("AQ_RECOVERY_UNAVAILABLE", "Not every combined fragment has a retained original payload; recovery cannot save a partial event");
    }
    if (!has("_aqOriginals")) return [restore(msg._aqOriginal, payloadType)];
    if (has("_aqOriginal") || !Array.isArray(msg._aqOriginals) || !msg._aqOriginals.length) {
        throw failure("AQ_RECOVERY_INVALID", "Invalid retained original payload collection");
    }
    var originals = [];
    // Validate every original before Enqueue writes any records. A JSON array is one record.
    for (var i = 0; i < msg._aqOriginals.length; i++) {
        var item = Object.getOwnPropertyDescriptor(msg._aqOriginals, i);
        if (!item || !Object.prototype.hasOwnProperty.call(item, "value") || typeof item.value !== "string") {
            throw failure("AQ_RECOVERY_INVALID", "Invalid retained original payload collection");
        }
        originals.push(restore(item.value, payloadType));
    }
    return originals;
}

module.exports = { capture: capture, restore: restore, restoreMessage: restoreMessage, validateType: checkType };

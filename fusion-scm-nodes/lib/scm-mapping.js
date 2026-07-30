var fieldMetadata = require("./scm-field-metadata.js");

function parseMappings(raw) {
    if (Array.isArray(raw)) return raw;
    try {
        var parsed = JSON.parse(raw || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function resolvePayload(mappings, msg, RED) {
    var payload = {};
    for (var i = 0; i < mappings.length; i++) {
        var mapping = mappings[i];
        if (!mapping.scmField) continue;
        fieldMetadata.validateMappingDefinition(mapping);
        payload[mapping.scmField] = resolveMappingValue(mapping, msg, RED);
    }
    return payload;
}

function resolveRequestPayload(payloadSource, mappings, msg, RED, options) {
    var source = payloadSource || "mappings";
    if (source === "mappings") {
        var mappedPayload = resolvePayload(mappings, msg, RED);
        if (
            Object.keys(mappedPayload).length === 0 &&
            !(options && options.allowEmptyMappedPayload)
        ) {
            throw createPayloadValidationError(
                "Mapped fields requires at least one payload mapping"
            );
        }
        return mappedPayload;
    }
    if (source === "msgPayload") {
        if (!isPlainObject(msg.payload)) {
            throw createPayloadValidationError("msg.payload must be a plain JSON object");
        }
        return cloneJsonValue(msg.payload, "msg.payload", new WeakSet());
    }
    throw createPayloadValidationError("Payload Source must be mappings or msgPayload");
}

function cloneJsonValue(value, path, activeObjects) {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        if (Number.isFinite(value)) return value;
        throwUnsupportedJsonValue(path);
    }
    if (Array.isArray(value)) {
        return cloneJsonCollection(value, path, activeObjects, function (array, index, clonedValue) {
            array.push(clonedValue);
        }, []);
    }
    if (isPlainObject(value)) {
        return cloneJsonCollection(value, path, activeObjects, function (object, key, clonedValue) {
            object[key] = clonedValue;
        }, {});
    }
    throwUnsupportedJsonValue(path);
}

function cloneJsonCollection(value, path, activeObjects, addValue, copy) {
    if (activeObjects.has(value)) {
        throwUnsupportedJsonValue(path);
    }
    activeObjects.add(value);

    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (isProhibitedKey(key)) {
            throw createPayloadValidationError("msg.payload contains a prohibited key at " + formatPath(path, key));
        }
        addValue(copy, key, cloneJsonValue(value[key], formatPath(path, key), activeObjects));
    }

    activeObjects.delete(value);
    return copy;
}

function isPlainObject(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isProhibitedKey(key) {
    return key === "__proto__" || key === "prototype" || key === "constructor";
}

function formatPath(path, key) {
    return Array.isArray(key) || String(Number(key)) === String(key)
        ? path + "[" + key + "]"
        : path + "." + key;
}

function throwUnsupportedJsonValue(path) {
    throw createPayloadValidationError("msg.payload contains an unsupported JSON value at " + path);
}

function createPayloadValidationError(message) {
    var error = new Error(message);
    error.scmPayloadValidationError = true;
    return error;
}

function resolveMappingValue(mapping, msg, RED) {
    if (mapping.sourceType === "dequeued") {
        return RED.util.getMessageProperty(msg, "dequeued." + (mapping.value || ""));
    }
    if (mapping.sourceType === "msg") {
        return RED.util.getMessageProperty(msg, mapping.value || "");
    }
    if (mapping.sourceType === "staticNumber") {
        return parseStaticNumber(mapping);
    }
    if (mapping.sourceType === "staticBoolean") {
        return parseStaticBoolean(mapping);
    }
    if (mapping.sourceType === "staticJson") {
        return parseStaticJson(mapping);
    }
    if (mapping.sourceType === "currentTimestamp") {
        return new Date().toISOString();
    }
    return mapping.value || "";
}

function parseStaticNumber(mapping) {
    var raw = mapping.value == null ? "" : String(mapping.value).trim();
    if (!raw) {
        throw new Error("Invalid static number for " + mapping.scmField + ": value is required");
    }
    var value = Number(raw);
    if (!Number.isFinite(value)) {
        throw new Error("Invalid static number for " + mapping.scmField + ": " + raw);
    }
    return value;
}

function parseStaticBoolean(mapping) {
    if (mapping.value === true || mapping.value === false) {
        return mapping.value;
    }
    var raw = mapping.value == null ? "" : String(mapping.value).trim().toLowerCase();
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new Error("Invalid static boolean for " + mapping.scmField + ": expected true or false");
}

function parseStaticJson(mapping) {
    var raw = mapping.value == null ? "" : String(mapping.value).trim();
    if (!raw) {
        throw new Error("Invalid static JSON for " + mapping.scmField + ": value is required");
    }
    try {
        return JSON.parse(raw);
    } catch (err) {
        throw new Error("Invalid static JSON for " + mapping.scmField + ": " + err.message);
    }
}

module.exports = {
    parseMappings: parseMappings,
    resolvePayload: resolvePayload,
    resolveRequestPayload: resolveRequestPayload
};

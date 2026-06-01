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
        payload[mapping.scmField] = resolveMappingValue(mapping, msg, RED);
    }
    return payload;
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
    resolvePayload: resolvePayload
};

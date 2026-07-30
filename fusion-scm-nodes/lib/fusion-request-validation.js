var URL = require("url").URL;
var {
    ensureAllowedScmResourceUrl,
    ensureHttps,
    formatFusionRestBaseUrl
} = require("./url.js");

var REQUEST_MEDIA_TYPES = {
    resourceItem: "application/vnd.oracle.adf.resourceitem+json",
    adfAction: "application/vnd.oracle.adf.action+json",
    json: "application/json",
    adfBatch: "application/vnd.oracle.adf.batch+json"
};
var ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
var BATCH_OPERATIONS = ["get", "create", "update", "replace", "delete", "invoke"];
var BATCH_PAYLOAD_OPERATIONS = ["create", "update", "replace"];

function createValidationError(message) {
    var err = new Error(message);
    err.fusionRequestValidationError = true;
    return err;
}

function resolveMethod(value) {
    var method = String(value || "").trim().toUpperCase();
    if (ALLOWED_METHODS.indexOf(method) === -1) {
        throw createValidationError("Unsupported HTTP method: " + (method || "<empty>"));
    }
    return method;
}

function resolveMediaType(value) {
    var key = String(value || "").trim() || "resourceItem";
    if (!Object.prototype.hasOwnProperty.call(REQUEST_MEDIA_TYPES, key)) {
        throw createValidationError("Unsupported request media type: " + (key || "<empty>"));
    }
    return {
        key: key,
        contentType: REQUEST_MEDIA_TYPES[key]
    };
}

function validateFusionRequest(options) {
    var method = resolveMethod(options.method);
    var mediaType = resolveMediaType(options.requestMediaType);
    var requestPayload = options.payload;
    var parsedUrl;

    try {
        parsedUrl = options.custom
            ? ensureAllowedScmResourceUrl(
                options.url,
                options.allowedHostname,
                options.apiVersion
            )
            : ensureHttps(options.url);
    } catch (err) {
        throw createValidationError(err.message);
    }

    if (mediaType.key === "adfAction" && method !== "POST") {
        throw createValidationError("ADF Action requests must use POST");
    }
    if (mediaType.key === "adfBatch") {
        requestPayload = validateBatchRequest(
            parsedUrl,
            options.allowedHostname,
            options.apiVersion,
            method,
            options.payload
        );
    }

    return {
        method: method,
        contentType: mediaType.contentType,
        url: parsedUrl.toString(),
        payload: requestPayload
    };
}

function validateBatchRequest(parsedUrl, allowedHostname, apiVersion, method, payload) {
    if (method !== "POST") {
        throw createValidationError("ADF Batch requests must use POST");
    }

    var configuredRoot = new URL(formatFusionRestBaseUrl(allowedHostname, apiVersion));
    var requestPath = parsedUrl.pathname.replace(/\/$/, "");
    var configuredPath = configuredRoot.pathname.replace(/\/$/, "");
    if (
        parsedUrl.origin !== configuredRoot.origin ||
        requestPath !== configuredPath ||
        parsedUrl.search
    ) {
        throw createValidationError(
            "ADF Batch requests must target the exact configured SCM API-version root"
        );
    }

    if (!isObject(payload) || !Array.isArray(payload.parts) || payload.parts.length === 0) {
        throw createValidationError("ADF Batch payload must contain a non-empty parts array");
    }

    var ids = Object.create(null);
    var normalizedParts = [];
    for (var i = 0; i < payload.parts.length; i++) {
        normalizedParts.push(validateBatchPart(payload.parts[i], i, ids));
    }

    return Object.assign({}, payload, {
        parts: normalizedParts
    });
}

function validateBatchPart(part, index, ids) {
    var label = "ADF Batch part " + (index + 1);
    if (!isObject(part)) {
        throw createValidationError(label + " must be an object");
    }

    var id = typeof part.id === "string" ? part.id.trim() : "";
    if (!id) {
        throw createValidationError(label + " requires a non-empty id");
    }
    if (Object.prototype.hasOwnProperty.call(ids, id)) {
        throw createValidationError("ADF Batch payload contains duplicate id: " + id);
    }
    ids[id] = true;

    validateBatchPartPath(part.path, label);

    var operation = typeof part.operation === "string"
        ? part.operation.trim().toLowerCase()
        : "";
    if (
        BATCH_OPERATIONS.indexOf(operation) === -1 ||
        part.operation.trim() !== operation
    ) {
        throw createValidationError(
            label + " has unsupported operation: " + (part.operation || "<empty>")
        );
    }
    if (
        BATCH_PAYLOAD_OPERATIONS.indexOf(operation) !== -1 &&
        !isObject(part.payload)
    ) {
        throw createValidationError(
            label + " operation " + operation + " requires an object payload"
        );
    }
    if (
        operation === "invoke" &&
        Object.prototype.hasOwnProperty.call(part, "payload") &&
        !isObject(part.payload)
    ) {
        throw createValidationError(
            label + " operation invoke requires an object payload when payload is supplied"
        );
    }

    var normalizedPath = part.path;
    if (operation !== "invoke") {
        normalizedPath = part.path.trim();
        if (normalizedPath.charAt(0) !== "/") {
            normalizedPath = "/" + normalizedPath;
        }
    }

    return Object.assign({}, part, {
        path: normalizedPath
    });
}

function validateBatchPartPath(value, label) {
    var raw = typeof value === "string" ? value.trim() : "";
    var rawPath = raw.split("?")[0];
    if (
        !raw ||
        raw.startsWith("//") ||
        /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) ||
        raw.indexOf("\\") !== -1 ||
        raw.indexOf("#") !== -1 ||
        !rawPath ||
        rawPath === "/"
    ) {
        throw createValidationError(label + " path must be a relative Fusion resource path");
    }

    var decoded = rawPath;
    var stable = false;
    for (var i = 0; i < 10; i++) {
        var next;
        try {
            next = decodeURIComponent(decoded);
        } catch (err) {
            throw createValidationError(label + " path contains invalid URL encoding");
        }
        if (next === decoded) {
            stable = true;
            break;
        }
        decoded = next;
    }
    if (!stable) {
        throw createValidationError(label + " path contains too many encoding layers");
    }

    if (
        decoded.startsWith("//") ||
        /^[A-Za-z][A-Za-z0-9+.-]*:/.test(decoded) ||
        decoded.indexOf("\\") !== -1 ||
        decoded.indexOf("#") !== -1 ||
        decoded.split("/").some(function (segment) {
            return segment === "." || segment === "..";
        })
    ) {
        throw createValidationError(label + " path must not contain path traversal");
    }
}

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
    REQUEST_MEDIA_TYPES: REQUEST_MEDIA_TYPES,
    createValidationError: createValidationError,
    validateFusionRequest: validateFusionRequest
};

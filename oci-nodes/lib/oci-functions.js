var endpointSupport = require("./oci-endpoint.js");
var responseSupport = require("./oci-response.js");

function validateEndpoint(value) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error("Invoke Endpoint is required");
    }

    var parsed;
    try {
        parsed = new URL(value.trim());
    } catch (err) {
        throw new Error("Invoke Endpoint must be a valid HTTPS OCI Functions base endpoint");
    }

    if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        (parsed.pathname && parsed.pathname !== "/") ||
        parsed.search ||
        parsed.hash ||
        (parsed.port && parsed.port !== "443") ||
        !endpointSupport.matchesKnownRealm(
            parsed.hostname,
            /^[a-z0-9-]+\.[a-z0-9-]+\.functions\.oci\.([a-z0-9.-]+)$/i
        )
    ) {
        throw new Error("Invoke Endpoint must be an HTTPS OCI Functions base endpoint without a path, query, or credentials");
    }
    return parsed.origin;
}

function serializeBody(value) {
    if (value === undefined || Buffer.isBuffer(value) || typeof value === "string") {
        return value;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new Error("msg.payload must be a finite number");
        }
        return String(value);
    }
    if (typeof value === "boolean") {
        return String(value);
    }
    if (value === null || typeof value === "object") {
        try {
            var serialized = JSON.stringify(value);
            if (serialized === undefined) throw new Error("empty JSON result");
            return serialized;
        } catch (err) {
            throw new Error("msg.payload must be JSON-serializable");
        }
    }
    throw new Error("msg.payload has an unsupported value type");
}

async function readResponse(value, maxResponseBytes, contentLength) {
    return parseBody(await responseSupport.readBuffer(value, maxResponseBytes, contentLength));
}
function parseBody(buffer) {
    if (!buffer.length) return "";
    if (!isUtf8(buffer)) return buffer;
    var text = buffer.toString("utf8");
    try {
        return JSON.parse(text);
    } catch (err) {
        return text;
    }
}

function isUtf8(buffer) {
    var bufferModule = require("node:buffer");
    if (typeof bufferModule.isUtf8 === "function") return bufferModule.isUtf8(buffer);
    try {
        new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        return true;
    } catch (err) {
        return false;
    }
}

function reattachTransaction(input, output) {
    if (!input.transaction) return;
    Object.defineProperty(output, "transaction", {
        value: input.transaction,
        enumerable: false,
        writable: true,
        configurable: true
    });
}

module.exports = {
    validateEndpoint: validateEndpoint,
    serializeBody: serializeBody,
    readResponse: readResponse,
    reattachTransaction: reattachTransaction
};

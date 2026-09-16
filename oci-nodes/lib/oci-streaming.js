var endpointSupport = require("./oci-endpoint.js");
var MAX_KEY_BYTES = 256;
var MAX_MESSAGE_BYTES = 1024 * 1024;
var MAX_REQUEST_BYTES = 1024 * 1024;

function validationError(message) {
    var err = new Error(message);
    err.isValidation = true;
    return err;
}

function validateEndpoint(value) {
    if (typeof value !== "string" || !value.trim()) {
        throw validationError("Messages Endpoint is required");
    }

    var parsed;
    try {
        parsed = new URL(value.trim());
    } catch (err) {
        throw validationError("Messages Endpoint must be a valid HTTPS OCI Streaming endpoint");
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
            /^[a-z0-9-]+\.streaming\.[a-z0-9-]+\.oci\.([a-z0-9.-]+)$/i
        )
    ) {
        throw validationError("Messages Endpoint must be an HTTPS OCI Streaming messages endpoint without a path, query, or credentials");
    }

    return parsed.origin;
}

function serializeValue(value, fieldName) {
    var serialized;
    if (Buffer.isBuffer(value)) {
        return value;
    }

    switch (typeof value) {
    case "string":
        return Buffer.from(value, "utf8");
    case "number":
        if (!Number.isFinite(value)) {
            throw validationError(fieldName + " must be a finite number");
        }
        return Buffer.from(String(value), "utf8");
    case "boolean":
        return Buffer.from(String(value), "utf8");
    case "object":
        if (value === null) {
            return Buffer.from("null", "utf8");
        }
        try {
            serialized = JSON.stringify(value);
        } catch (err) {
            throw validationError(fieldName + " must be JSON-serializable");
        }
        if (serialized === undefined) {
            throw validationError(fieldName + " must be JSON-serializable");
        }
        return Buffer.from(serialized, "utf8");
    default:
        throw validationError(fieldName + " has an unsupported type");
    }
}

function decodeText(value) {
    if (value === null || value === undefined) return null;
    var bytes = Buffer.from(value, "base64");
    var text = bytes.toString("utf8");
    return Buffer.from(text, "utf8").equals(bytes) ? text : bytes;
}

function decodeValue(value) {
    var decoded = decodeText(value);
    if (decoded === null || typeof decoded !== "string") return decoded;
    try {
        return JSON.parse(decoded);
    } catch (err) {
        return decoded;
    }
}

function readInteger(value, defaultValue, minimum, maximum, fieldName) {
    var candidate = value === undefined || value === null || value === ""
        ? defaultValue
        : Number(value);
    if (!Number.isInteger(candidate) || candidate < minimum || candidate > maximum) {
        throw validationError(
            fieldName + " must be an integer between " + minimum + " and " + maximum
        );
    }
    return candidate;
}

function buildEntry(value, key, valueFieldName, keyFieldName) {
    var valueBuffer = serializeValue(value, valueFieldName);
    if (valueBuffer.length > MAX_MESSAGE_BYTES) {
        throw validationError(valueFieldName + " must be at most 1 MiB");
    }
    var entry = {
        value: valueBuffer.toString("base64")
    };
    if (key !== undefined) {
        var keyBuffer = serializeValue(key, keyFieldName);
        if (keyBuffer.length > MAX_KEY_BYTES) {
            throw validationError(keyFieldName + " must be at most 256 bytes");
        }
        entry.key = keyBuffer.toString("base64");
    }
    return entry;
}

function validateRequestSize(messages) {
    var size = messages.reduce(function (total, message) {
        return total + Buffer.byteLength(message.value, "base64") +
            (message.key ? Buffer.byteLength(message.key, "base64") : 0);
    }, 0);
    if (size > MAX_REQUEST_BYTES) {
        throw validationError("OCI Streaming request must be at most 1 MiB after Base64 decoding");
    }
    return messages;
}

function buildMessages(payload, input) {
    input = input || {};
    if (Object.prototype.hasOwnProperty.call(input, "messages")) {
        if (!Array.isArray(input.messages) || input.messages.length === 0) {
            throw validationError("msg.ociStreaming.messages must be a non-empty array");
        }
        return validateRequestSize(input.messages.map(function (message, index) {
            if (
                !message ||
                typeof message !== "object" ||
                Array.isArray(message) ||
                !Object.prototype.hasOwnProperty.call(message, "value")
            ) {
                throw validationError("msg.ociStreaming.messages[" + index + "] must contain a value");
            }
            return buildEntry(
                message.value,
                message.key,
                "msg.ociStreaming.messages[" + index + "].value",
                "msg.ociStreaming.messages[" + index + "].key"
            );
        }));
    }
    return validateRequestSize([
        buildEntry(payload, input.key, "msg.payload", "msg.ociStreaming.key")
    ]);
}

function getOpcRequestId(input) {
    if (!Object.prototype.hasOwnProperty.call(input, "opcRequestId")) {
        return null;
    }
    if (typeof input.opcRequestId !== "string" || !input.opcRequestId.trim()) {
        throw validationError("msg.ociStreaming.opcRequestId must be a non-empty string");
    }
    return input.opcRequestId.trim();
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

function redactError(err, values) {
    if (!err || typeof err.message !== "string") return err;
    var message = err.message;
    values.forEach(function (value) {
        if (typeof value === "string" && value) {
            message = message.split(value).join("[redacted]");
        }
    });
    if (message === err.message) return err;

    var safe = new Error(message);
    ["serviceCode", "errorCode", "code", "statusCode", "opcRequestId", "isValidation"].forEach(function (name) {
        if (err[name] !== undefined) safe[name] = err[name];
    });
    return safe;
}

module.exports = {
    buildMessages: buildMessages,
    decodeText: decodeText,
    decodeValue: decodeValue,
    getOpcRequestId: getOpcRequestId,
    readInteger: readInteger,
    redactError: redactError,
    reattachTransaction: reattachTransaction,
    validationError: validationError,
    validateEndpoint: validateEndpoint
};

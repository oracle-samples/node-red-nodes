function parseBrokers(value) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error("Bootstrap Brokers is required");
    }

    var seen = {};
    var brokers = [];
    value.split(/[\s,]+/).forEach(function (entry) {
        var broker = entry.trim();
        if (!broker) return;
        validateBroker(broker);
        if (!seen[broker]) {
            seen[broker] = true;
            brokers.push(broker);
        }
    });

    if (!brokers.length) {
        throw new Error("Bootstrap Brokers is required");
    }
    return brokers;
}

function validateBroker(broker) {
    if (broker.indexOf("://") !== -1) {
        throw new Error("Bootstrap Brokers must use host:port entries without a URL scheme");
    }

    var parsed;
    try {
        parsed = new URL("kafka://" + broker);
    } catch (err) {
        throw new Error("Bootstrap Brokers must contain valid host:port entries");
    }

    var port = Number(parsed.port);
    if (
        !parsed.hostname ||
        !parsed.port ||
        port < 1 ||
        port > 65535 ||
        parsed.username ||
        parsed.password ||
        (parsed.pathname && parsed.pathname !== "/") ||
        parsed.search ||
        parsed.hash
    ) {
        throw new Error("Bootstrap Brokers must contain valid host:port entries");
    }
}

function serializeValue(value, fieldName) {
    var name = fieldName || "value";
    if (Buffer.isBuffer(value) || typeof value === "string") {
        return value;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new Error(name + " must be a finite number");
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
            throw new Error(name + " must be JSON-serializable");
        }
    }
    throw new Error(name + " has an unsupported value type");
}

function normalizeHeaders(headers) {
    if (headers === undefined || headers === null) {
        return undefined;
    }
    if (!isPlainObject(headers)) {
        throw new Error("Kafka headers must be a plain object");
    }

    var normalized = {};
    Object.keys(headers).forEach(function (name) {
        var value = headers[name];
        if (typeof value === "number") {
            if (!Number.isFinite(value)) {
                throw new Error("Kafka headers must contain finite scalar values or buffers");
            }
            value = String(value);
        } else if (typeof value === "boolean") {
            value = String(value);
        } else if (!Buffer.isBuffer(value) && typeof value !== "string" && value !== null) {
            throw new Error("Kafka headers must contain scalar values or buffers");
        }
        Object.defineProperty(normalized, name, {
            value: value,
            enumerable: true,
            writable: true,
            configurable: true
        });
    });
    return normalized;
}

function isPlainObject(value) {
    if (!value || Object.prototype.toString.call(value) !== "[object Object]") {
        return false;
    }
    var prototype = Object.getPrototypeOf(value);
    if (prototype === null) return true;
    // Function-node objects have a different realm's Object.prototype.
    var constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
    return Object.getPrototypeOf(prototype) === null &&
        constructor && typeof constructor.value === "function" && constructor.value.prototype === prototype &&
        Function.prototype.toString.call(constructor.value) === Function.prototype.toString.call(Object);
}

function buildMessage(payload, options) {
    options = options || {};
    var message = {
        value: serializeValue(payload, "payload")
    };

    if (options.key !== undefined) {
        message.key = serializeValue(options.key, "Kafka key");
    }
    if (options.headers !== undefined) {
        message.headers = normalizeHeaders(options.headers);
    }
    if (options.partition !== undefined && options.partition !== null) {
        if (!Number.isInteger(options.partition) || options.partition < 0) {
            throw new Error("Kafka partition must be a non-negative integer");
        }
        message.partition = options.partition;
    }
    return message;
}

function decodeText(value) {
    if (!Buffer.isBuffer(value)) return value;
    var text = value.toString("utf8");
    return Buffer.from(text, "utf8").equals(value) ? text : value;
}

function decodeValue(value) {
    var decoded = decodeText(value);
    if (typeof decoded !== "string") return decoded;
    try {
        return JSON.parse(decoded);
    } catch (err) {
        return decoded;
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
    ["serviceCode", "errorCode", "code", "statusCode", "opcRequestId"].forEach(function (name) {
        if (err[name] !== undefined) safe[name] = err[name];
    });
    return safe;
}

module.exports = {
    parseBrokers: parseBrokers,
    serializeValue: serializeValue,
    normalizeHeaders: normalizeHeaders,
    buildMessage: buildMessage,
    decodeText: decodeText,
    decodeValue: decodeValue,
    reattachTransaction: reattachTransaction,
    redactError: redactError
};

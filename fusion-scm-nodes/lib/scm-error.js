function normalizeError(err) {
    var response = err && err.response;
    var responseData = response && response.data !== undefined
        ? redactValue(response.data, new WeakSet()) : undefined;
    var statusCode = response && response.status ? response.status : 0;
    var message = redactText(extractResponseMessage(responseData) || (err && err.message) || String(err));

    return {
        message: message,
        code: resolveErrorCode(err, statusCode),
        statusCode: statusCode,
        payload: responseData !== undefined ? responseData : message
    };
}

function handleNodeError(node, msg, err, done, options) {
    options = options || {};
    var normalized = normalizeError(err);
    node.status({
        fill: "red",
        shape: options.statusShape || "dot",
        text: options.statusText || "request failed"
    });
    msg.error = {
        message: normalized.message,
        code: normalized.code
    };
    msg.statusCode = normalized.statusCode;
    msg.payload = normalized.payload;

    // Axios errors retain credential-bearing request config and response objects.
    var doneErr = new Error(normalized.message);
    if (err && typeof err.stack === "string") doneErr.stack = redactText(err.stack);
    if (normalized.statusCode) {
        doneErr.statusCode = normalized.statusCode;
    }

    doneErr.code = normalized.code;
    done(doneErr);
}

function redactText(value) {
    var text = String(value || "");
    if (/^\s*[\[{]/.test(text)) {
        try {
            var parsed = JSON.parse(text);
            var sanitized = JSON.stringify(redactValue(parsed, new WeakSet()));
            // Escaped quotes in JSON credentials cannot be safely masked by a text regex.
            return sanitized === JSON.stringify(parsed) ? text : sanitized;
        } catch (err) { /* Non-JSON diagnostics use the text patterns below. */ }
    }
    return text
        .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, "[REDACTED PRIVATE KEY]")
        .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED TOKEN]")
        .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+\/._~=-]+/gi, "$1 [REDACTED]")
        .replace(/(^|\r?\n)((?:set-)?cookie|(?:proxy-)?authorization)\s*:[^\r\n]*/gi, "$1$2: [REDACTED]")
        .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@")
        .replace(/\b([A-Za-z0-9_-]*(?:password|passwd|passphrase|token|private[_-]?key|secret|authorization|cookie)[A-Za-z0-9_-]*)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi, "$1$2\"[REDACTED]\"");
}

function redactValue(value, active) {
    if (typeof value === "string") return redactText(value);
    if (Buffer.isBuffer(value)) {
        var text = value.toString("utf8");
        var sanitized = redactText(text);
        return sanitized === text ? Buffer.from(value) : Buffer.from(sanitized, "utf8");
    }
    if (!value || typeof value !== "object") return value;
    if (active.has(value)) return "[Circular]";
    active.add(value);
    var copy = Array.isArray(value) ? [] : {};
    Object.keys(value).forEach(function (key) {
        var sensitive = /password|passwd|passphrase|token|private[_-]?key|secret|authorization|cookie/i.test(key);
        Object.defineProperty(copy, key, {
            value: sensitive ? "[REDACTED]" : redactValue(value[key], active),
            enumerable: true, configurable: true, writable: true
        });
    });
    active.delete(value);
    return copy;
}

function resolveErrorCode(err, statusCode) {
    var code = statusCode || (err && (err.errorNum || err.statusCode || err.code));
    return code ? String(code) : null;
}

function extractResponseMessage(data) {
    if (data === undefined || data === null) {
        return null;
    }
    if (typeof data === "string") {
        return normalizeString(data);
    }
    if (Buffer.isBuffer(data)) {
        return normalizeString(data.toString("utf8"));
    }
    if (Array.isArray(data)) {
        return joinMessages(data.map(extractResponseMessage));
    }
    if (typeof data === "object") {
        var detailMessage = firstString(data.detail, data.message, data.errorMessage, data.title);
        if (detailMessage) {
            return detailMessage;
        }

        var nestedMessage = joinMessages([
            extractResponseMessage(data["o:errorDetails"]),
            extractResponseMessage(data.errorDetails),
            extractResponseMessage(data.errors),
            extractResponseMessage(data.details)
        ]);
        if (nestedMessage) {
            return nestedMessage;
        }

        try {
            return normalizeString(JSON.stringify(data));
        } catch (e) {
            return null;
        }
    }
    return normalizeString(String(data));
}

function firstString() {
    for (var i = 0; i < arguments.length; i++) {
        var value = normalizeString(arguments[i]);
        if (value) return value;
    }
    return null;
}

function joinMessages(messages) {
    var seen = {};
    var joined = [];
    for (var i = 0; i < messages.length; i++) {
        var message = normalizeString(messages[i]);
        if (message && !seen[message]) {
            seen[message] = true;
            joined.push(message);
        }
    }
    return joined.length ? joined.join(" ") : null;
}

function normalizeString(value) {
    if (typeof value !== "string") {
        return null;
    }
    var trimmed = value.trim();
    return trimmed || null;
}

module.exports = {
    redactText: redactText,
    normalizeError: normalizeError,
    handleNodeError: handleNodeError
};

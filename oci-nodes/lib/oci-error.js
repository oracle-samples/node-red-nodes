function redactText(value) {
    if (value === undefined || value === null) return "";
    return String(value)
        .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, "[redacted private key]")
        .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted token]")
        .replace(/(^|\r?\n)((?:set-)?cookie|(?:proxy-)?authorization)\s*:[^\r\n]*/gi, "$1$2: [redacted]")
        .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
        .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi, "[redacted authorization]")
        .replace(/(["']?\b(?:authorization|proxy-authorization|cookie|set-cookie)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,;]+)/gi, "$1[redacted]")
        .replace(/(["']?\b[A-Za-z0-9_-]*(?:password|passwd|passphrase|secret|token|private[_-]?key)[A-Za-z0-9_-]*["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]]+)/gi, "$1[redacted]");
}

function redactValue(value, seen, depth) {
    if (typeof value === "string") {
        var parsed = parseJsonString(value);
        if (parsed) {
            var clean = JSON.stringify(redactValue(parsed, seen, (depth || 0) + 1));
            return clean === JSON.stringify(parsed) ? value : clean;
        }
        return redactText(value);
    }
    if (!value || typeof value !== "object") return value;
    if (Buffer.isBuffer(value)) {
        var text = value.toString("utf8");
        var redacted = redactValue(text, seen, depth);
        return redacted === text ? Buffer.from(value) : Buffer.from(redacted, "utf8");
    }
    if (value instanceof Date) return new Date(value.getTime());
    seen = seen || new Set();
    depth = depth || 0;
    if (seen.has(value)) return "[circular diagnostic]";
    if (depth >= 16) return "[nested diagnostic omitted]";
    seen.add(value);
    var result = Array.isArray(value) ? [] : {};
    Object.keys(value).forEach(function (key) {
        var sensitive = /password|passwd|passphrase|secret|authorization|cookie|token|privatekey/i.test(key.replace(/[_-]/g, ""));
        Object.defineProperty(result, key, {
            value: sensitive ? "[redacted]" : redactValue(value[key], seen, depth + 1),
            enumerable: true, writable: true, configurable: true
        });
    });
    seen.delete(value);
    return result;
}

function normalizeError(err) {
    var response = err && err.response;
    var responseData = redactValue(resolveResponseData(err, response));
    var statusCode = resolveStatusCode(err, response);
    var message = extractResponseMessage(responseData) || firstString(
        err && redactText(err.message),
        err && redactText(err.serviceCode),
        err && redactText(err.code)
    ) || redactText(String(err));

    return {
        message: message,
        code: resolveErrorCode(err, statusCode) === null ? null : redactText(resolveErrorCode(err, statusCode)),
        statusCode: statusCode,
        payload: responseData !== undefined ? responseData : message,
        hasResponsePayload: responseData !== undefined,
        opcRequestId: resolveOpcRequestId(err, response) === null ? null : redactText(resolveOpcRequestId(err, response))
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
    if (normalized.opcRequestId) {
        msg.opcRequestId = normalized.opcRequestId;
    }
    if (options.setPayload !== false) {
        msg.payload = normalized.payload;
    }

    // Provider errors can retain raw request headers, bodies and credentials.
    var doneErr = new Error(normalized.message);
    if (normalized.statusCode) doneErr.statusCode = normalized.statusCode;
    if (normalized.opcRequestId) doneErr.opcRequestId = normalized.opcRequestId;

    if (err && typeof err.isValidation === "boolean") doneErr.isValidation = err.isValidation;
    doneErr.code = normalized.code;
    done(doneErr);
}

function resolveResponseData(err, response) {
    if (response) {
        if (response.data !== undefined) return response.data;
        if (response.body !== undefined) return response.body;
        if (response.responseBody !== undefined) return response.responseBody;
    }
    if (err) {
        if (err.responseData !== undefined) return err.responseData;
        if (err.body !== undefined) return err.body;
        if (err.responseBody !== undefined) return err.responseBody;
    }
    return undefined;
}

function resolveStatusCode(err, response) {
    return Number(
        (response && (response.statusCode || response.status)) ||
        (err && (err.statusCode || err.__httpStatusCode || err.status)) ||
        0
    ) || 0;
}

function resolveErrorCode(err, statusCode) {
    var code = err && (err.serviceCode || err.errorCode || err.code || err.errorNum);
    if (!code && statusCode) {
        code = statusCode;
    }
    return code ? String(code) : null;
}

function resolveOpcRequestId(err, response) {
    var headers = response && response.headers;
    return firstString(
        err && err.opcRequestId,
        err && err.opcRequestID,
        response && response.opcRequestId,
        headers && (headers["opc-request-id"] || headers["opc-requestid"] || headers["Opc-Request-Id"])
    );
}

function extractResponseMessage(data) {
    if (data === undefined || data === null) {
        return null;
    }
    if (typeof data === "string") {
        var trimmed = normalizeString(data);
        if (!trimmed) return null;
        var parsed = parseJsonString(trimmed);
        return parsed ? extractResponseMessage(parsed) || trimmed : trimmed;
    }
    if (Buffer.isBuffer(data)) {
        return extractResponseMessage(data.toString("utf8"));
    }
    if (Array.isArray(data)) {
        return joinMessages(data.map(extractResponseMessage));
    }
    if (typeof data === "object") {
        var direct = firstString(data.detail, data.message, data.errorMessage, data.title, data.reason, data.reasonMessage);
        if (direct) {
            return direct;
        }

        var nested = joinMessages([
            extractResponseMessage(data["o:errorDetails"]),
            extractResponseMessage(data.errorDetails),
            extractResponseMessage(data.errors),
            extractResponseMessage(data.details),
            extractResponseMessage(data.error)
        ]);
        if (nested) {
            return nested;
        }

        try {
            return normalizeString(JSON.stringify(data));
        } catch (e) {
            return null;
        }
    }
    return normalizeString(String(data));
}

function parseJsonString(value) {
    if (!/^\s*[\[{]/.test(value)) {
        return null;
    }
    try {
        return JSON.parse(value);
    } catch (e) {
        return null;
    }
}

function firstString() {
    for (var i = 0; i < arguments.length; i++) {
        var value = normalizeString(arguments[i]);
        if (value) return value;
    }
    return null;
}

function joinMessages(messages) {
    var seen = Object.create(null);
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
    normalizeError: normalizeError,
    handleNodeError: handleNodeError
};

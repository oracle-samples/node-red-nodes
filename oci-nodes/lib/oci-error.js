function normalizeError(err) {
    var response = err && err.response;
    var responseData = resolveResponseData(err, response);
    var statusCode = resolveStatusCode(err, response);
    var message = extractResponseMessage(responseData) || firstString(
        err && err.message,
        err && err.serviceCode,
        err && err.code
    ) || String(err);

    return {
        message: message,
        code: resolveErrorCode(err, statusCode),
        statusCode: statusCode,
        payload: responseData !== undefined ? responseData : message,
        hasResponsePayload: responseData !== undefined,
        opcRequestId: resolveOpcRequestId(err, response)
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

    var doneErr = err instanceof Error ? err : new Error(normalized.message);
    if (doneErr.message !== normalized.message) {
        doneErr.ociOriginalMessage = doneErr.message;
        doneErr.message = normalized.message;
    }
    if (normalized.statusCode && !doneErr.statusCode) {
        doneErr.statusCode = normalized.statusCode;
    }

    node.error(normalized.message, msg);
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
    normalizeError: normalizeError,
    handleNodeError: handleNodeError
};

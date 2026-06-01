function normalizeError(err) {
    var response = err && err.response;
    var responseData = response && response.data !== undefined ? response.data : undefined;
    var statusCode = response && response.status ? response.status : 0;
    var message = extractResponseMessage(responseData) || (err && err.message) || String(err);

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

    var doneErr = err instanceof Error ? err : new Error(normalized.message);
    if (doneErr.message !== normalized.message) {
        doneErr.scmOriginalMessage = doneErr.message;
        doneErr.message = normalized.message;
    }
    if (normalized.statusCode && !doneErr.statusCode) {
        doneErr.statusCode = normalized.statusCode;
    }

    node.error(normalized.message, msg);
    done(doneErr);
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
    normalizeError: normalizeError,
    handleNodeError: handleNodeError
};

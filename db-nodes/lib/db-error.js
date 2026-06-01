function normalizeError(err) {
    var message = (err && err.message) || String(err);
    return {
        message: message,
        code: resolveErrorCode(err)
    };
}

function handleNodeError(node, msg, err, done, options) {
    options = options || {};
    var normalized = normalizeError(err);
    node.status({
        fill: "red",
        shape: options.statusShape || "dot",
        text: options.statusText || "query failed"
    });
    msg.error = {
        message: normalized.message,
        code: normalized.code
    };

    var doneErr = err instanceof Error ? err : new Error(normalized.message);
    if (doneErr.message !== normalized.message) {
        doneErr.dbOriginalMessage = doneErr.message;
        doneErr.message = normalized.message;
    }

    node.error(normalized.message, msg);
    done(doneErr);
}

function resolveErrorCode(err) {
    var code = err && (err.errorNum || err.code);
    return code ? String(code) : null;
}

module.exports = {
    normalizeError: normalizeError,
    handleNodeError: handleNodeError
};

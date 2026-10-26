var diagnosticText = require("./diagnostic-text.js");

function assertActiveTransaction(transaction) {
    if (transaction === undefined || transaction === null) return;
    if (typeof transaction !== "object" || transaction.timedOut || transaction._ended || !transaction.connection) {
        var err = new Error("Transaction is inactive; start a new transaction before retrying");
        err.code = "DB_TRANSACTION_INACTIVE";
        throw err;
    }
}

function redactText(value) {
    var text = diagnosticText.redactJwt(diagnosticText.boundedText(value), "[REDACTED TOKEN]");
    text = text.replace(
        /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi,
        "[REDACTED PRIVATE KEY]"
    );
    text = text.replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.~\-]+/gi, "[REDACTED AUTHORIZATION]");
    text = diagnosticText.redactAssignments(text, "[REDACTED]");
    text = text.replace(
        /\b(wallet(?:Location|Path)?|configDir|tns_admin|privateKeyLocation|configFileLocation)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi,
        "$1=[REDACTED PATH]"
    );

    var descriptorIndex = text.search(/\(\s*description\s*=/i);
    if (descriptorIndex !== -1) {
        text = text.slice(0, descriptorIndex) + "[REDACTED CONNECT DESCRIPTOR]";
    }

    return text;
}

function normalizeError(err) {
    var message = redactText((err && err.message) || String(err));
    return {
        message: message,
        code: resolveErrorCode(err)
    };
}

function handleNodeError(node, msg, err, done, options) {
    options = options || {};
    var referenceError = err && (err.code === "DB_TRANSACTION_INACTIVE" || err.code === "DB_TRANSACTION_CONFIG_MISMATCH");
    if (options.markRollbackOnly !== false && !referenceError && msg.transaction && (msg.transaction._state === "active" || msg.transaction._state === "ending")) {
        msg.transaction._rollbackOnly = true;
    }
    var normalized = normalizeError(err);
    node.status({
        fill: "red",
        shape: err && err.code === "DB_TRANSACTION_INACTIVE" ? "ring" : options.statusShape || "dot",
        text: err && err.code === "DB_TRANSACTION_INACTIVE" ? "inactive transaction" : redactText(options.statusText || "query failed")
    });
    msg.error = {
        message: normalized.message,
        code: normalized.code
    };

    var doneErr = err instanceof Error ? err : new Error(normalized.message);
    if (doneErr.message !== normalized.message) {
        doneErr.message = normalized.message;
    }
    if (doneErr.stack) {
        doneErr.stack = redactText(doneErr.stack);
    }

    doneErr.code = normalized.code;
    done(doneErr);
}

function resolveErrorCode(err) {
    var code = err && (err.errorNum || err.code);
    return code ? String(code) : null;
}

module.exports = {
    assertActiveTransaction: assertActiveTransaction,
    redactText: redactText,
    normalizeError: normalizeError,
    handleNodeError: handleNodeError
};

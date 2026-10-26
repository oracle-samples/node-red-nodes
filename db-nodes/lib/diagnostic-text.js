/* Copyright (c) 2026 Oracle and/or its affiliates. Licensed under the UPL, Version 1.0. */

// Kept identical in the independently installable packages.
var MAX_DIAGNOSTIC_CHARS = 16384;

function boundedText(value) {
    var text = String(value == null ? "" : value);
    // Omit rather than truncate: a cut could leave part of a credential exposed.
    return text.length > MAX_DIAGNOSTIC_CHARS ? "[oversized diagnostic omitted]" : text;
}

function redactAssignments(value, marker) {
    var text = boundedText(value);
    var tokens = /[A-Za-z0-9_-]+/g;
    var delimiter = /["']?\s*[:=]\s*/y;
    var secretValue = /"(?:\\[\s\S]|[^"\\])*"?|'(?:\\[\s\S]|[^'\\])*'?|[^\s,;}\]]+/y;
    var parts = [];
    var copied = 0;
    var token;
    // Scan each maximal token once; searching again at every word boundary is quadratic.
    while ((token = tokens.exec(text))) {
        if (!/password|passwd|passphrase|secret|token|private[_-]?key|authorization|cookie/i.test(token[0])) continue;
        delimiter.lastIndex = tokens.lastIndex;
        if (!delimiter.exec(text)) continue;
        var start = delimiter.lastIndex;
        secretValue.lastIndex = start;
        if (!secretValue.exec(text)) continue;
        parts.push(text.slice(copied, start), marker);
        copied = secretValue.lastIndex;
        tokens.lastIndex = copied;
    }
    parts.push(text.slice(copied));
    return parts.join("");
}

function redactJwt(value, marker) {
    var text = boundedText(value);
    var tokens = /[A-Za-z0-9_-]+/g;
    var tail = /\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/y;
    var parts = [];
    var copied = 0;
    var token;
    while ((token = tokens.exec(text))) {
        var start = token[0].search(/(?:^|-)eyJ/);
        if (start === -1) continue;
        if (token[0][start] === "-") start++;
        tail.lastIndex = tokens.lastIndex;
        if (!tail.exec(text)) continue;
        parts.push(text.slice(copied, token.index + start), marker);
        copied = tail.lastIndex;
        tokens.lastIndex = copied;
    }
    parts.push(text.slice(copied));
    return parts.join("");
}

module.exports = { boundedText: boundedText, redactAssignments: redactAssignments, redactJwt: redactJwt };

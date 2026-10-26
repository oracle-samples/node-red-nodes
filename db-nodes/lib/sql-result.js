/* Copyright (c) 2026 Oracle and/or its affiliates. Licensed under the UPL, Version 1.0. */

var MAX_LOB_BYTES = 16 * 1024 * 1024;

async function materializeRows(rows, oracledb, assertOpen, maxBytes) {
    var limit = maxBytes === undefined ? MAX_LOB_BYTES : maxBytes;
    var bytes = 0;
    var lobs = new Set();
    var visited = new Set();
    var projections = new Map();
    function collect(value) {
        if (!value || typeof value !== "object" || visited.has(value)) return;
        visited.add(value);
        if (value instanceof oracledb.Lob) lobs.add(value);
        else if (oracledb.BaseDbObject && value instanceof oracledb.BaseDbObject) {
            // Project before reading LOBs; typed attributes cannot hold materialized text.
            var projected = value.isCollection ? value.getValues() : {};
            projections.set(value, projected);
            if (!value.isCollection) {
                value._objType.attributes.forEach(function (attribute) {
                    var attributeValue = value[attribute.name];
                    Object.defineProperty(projected, attribute.name, {
                        value: attributeValue, enumerable: true, configurable: true, writable: true
                    });
                    collect(attributeValue);
                });
            }
            collect(projected);
        } else if (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
            Object.keys(value).forEach(function (key) { collect(value[key]); });
        }
    }
    var values = new Map();
    var failed = false;
    try {
        collect(rows);
        for (var lob of lobs) {
            var chunks = [];
            for await (var chunk of lob) {
                if (assertOpen) assertOpen();
                bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk, "utf8");
                if (bytes > limit) {
                    var err = new Error("Returned LOB data exceeds the 16 MiB result limit");
                    err.code = "DB_LOB_TOO_LARGE";
                    throw err;
                }
                chunks.push(chunk);
            }
            var buffer = Buffer.concat(chunks.map(function (chunk) { return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); }));
            values.set(lob, lob.type === oracledb.DB_TYPE_BLOB || lob.type === oracledb.DB_TYPE_BFILE
                ? buffer : buffer.toString("utf8"));
        }
        if (assertOpen) assertOpen();
        visited.clear();
        function replace(value) {
            if (values.has(value)) return values.get(value);
            if (projections.has(value)) return replace(projections.get(value));
            if (!value || typeof value !== "object" || visited.has(value)) return value;
            visited.add(value);
            if (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
                Object.keys(value).forEach(function (key) {
                    Object.defineProperty(value, key, { value: replace(value[key]), enumerable: true, configurable: true, writable: true });
                });
            }
            return value;
        }
        return replace(rows);
    } catch (err) {
        failed = true;
        throw err;
    } finally {
        // Close unread locators serially: they share the same database connection.
        var cleanupError;
        for (var remaining of lobs) {
            if (remaining.closed) continue;
            await new Promise(function (resolve) {
                remaining.once("error", function (err) { cleanupError = cleanupError || err; });
                remaining.once("close", resolve);
                remaining.destroy();
            });
        }
        if (!failed && cleanupError) throw cleanupError;
    }
}

module.exports = { materializeRows: materializeRows, MAX_LOB_BYTES: MAX_LOB_BYTES };

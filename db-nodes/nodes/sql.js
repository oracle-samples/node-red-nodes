/*
 Copyright (c) 2025 Oracle and/or its affiliates.
 The Universal Permissive License (UPL), Version 1.0

 Subject to the condition set forth below, permission is hereby granted to any
 person obtaining a copy of this software, associated documentation and/or data
 (collectively the "Software"), free of charge and under any and all copyright
 rights in the Software, and any and all patent rights owned or freely
 licensable by each licensor hereunder covering either (i) the unmodified
 Software as contributed to or provided by such licensor, or (ii) the Larger
 Works (as defined below), to deal in both

 (a) the Software, and
 (b) any piece of software and/or hardware listed in the
     lrgrwrks.txt file if one is included with the Software (each a "Larger
     Work" to which the Software is contributed by such licensors),

 without restriction, including without limitation the rights to copy, create
 derivative works of, display, perform, and distribute the Software and make,
 use, sell, offer for sale, import, export, have made, and have sold the
 Software and the Larger Work(s), and to sublicense the foregoing rights on
 either these or other terms.

 This license is subject to the following condition: The above copyright notice
 and either this complete permission notice or at a minimum a reference to the
 UPL must be included in all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 SOFTWARE.
 */

module.exports = function (RED) {
    const oracledb = require("oracledb");

    function getQQuoteCloseDelimiter(openDelimiter) {
        switch (openDelimiter) {
            case "[":
                return "]";
            case "(":
                return ")";
            case "{":
                return "}";
            case "<":
                return ">";
            default:
                return openDelimiter;
        }
    }

    // Blank string literals, quoted identifiers, and comments in sql so the
    // placeholder regex cannot match ':' inside literal values like 'call :id'.
    // Spaces replace content character-for-character to keep indices aligned.
    function stripSqlForBindScan(sql) {
        var out = "";
        var state = "normal";
        var qCloseDelimiter = "";

        for (var i = 0; i < sql.length; i++) {
            var ch = sql[i];
            var next = i + 1 < sql.length ? sql[i + 1] : "";
            var next2 = i + 2 < sql.length ? sql[i + 2] : "";

            switch (state) {
                case "normal":
                    // Oracle q-quoting: q'X ... X' (and Q'X ... X').
                    if ((ch === "q" || ch === "Q") && next === "'" && next2) {
                        qCloseDelimiter = getQQuoteCloseDelimiter(next2);
                        state = "q_quote";
                        out += "   ";
                        i += 2;
                        continue;
                    }
                    if (ch === "'") {
                        state = "single_quote";
                        out += " ";
                        continue;
                    }
                    if (ch === "\"") {
                        state = "double_quote";
                        out += " ";
                        continue;
                    }
                    if (ch === "-" && next === "-") {
                        state = "line_comment";
                        out += "  ";
                        i++;
                        continue;
                    }
                    if (ch === "/" && next === "*") {
                        state = "block_comment";
                        out += "  ";
                        i++;
                        continue;
                    }
                    out += ch;
                    continue;
                case "single_quote":
                    if (ch === "'" && next === "'") {
                        // '' is Oracle's escaped single-quote — consume both chars
                        // so the second ' does not flip state back to normal.
                        out += "  ";
                        i++;
                        continue;
                    }
                    if (ch === "'") {
                        state = "normal";
                    }
                    out += " ";
                    continue;
                case "double_quote":
                    if (ch === "\"") {
                        state = "normal";
                    }
                    out += " ";
                    continue;
                case "line_comment":
                    if (ch === "\n" || ch === "\r") {
                        state = "normal";
                        out += ch;
                    } else {
                        out += " ";
                    }
                    continue;
                case "block_comment":
                    if (ch === "*" && next === "/") {
                        state = "normal";
                        out += "  ";
                        i++;
                    } else if (ch === "\n" || ch === "\r") {
                        out += ch;
                    } else {
                        out += " ";
                    }
                    continue;
                case "q_quote":
                    // q-quoted literal closes at <delimiter>' (for example ]' or |').
                    if (ch === qCloseDelimiter && next === "'") {
                        state = "normal";
                        qCloseDelimiter = "";
                        out += "  ";
                        i++;
                    } else if (ch === "\n" || ch === "\r") {
                        out += ch;
                    } else {
                        out += " ";
                    }
                    continue;
                default:
                    out += ch;
                    continue;
            }
        }

        return out;
    }

    function extractBindPlaceholders(sql) {
        if (!sql || typeof sql !== "string") {
            return { named: new Set(), positionalMax: 0 };
        }

        var sanitized = stripSqlForBindScan(sql);
        var named = new Set();
        var positionalMax = 0;
        // (^|[^:]) prevents matching :: which is Oracle's type-cast operator.
        var namedRe = /(^|[^:]):([a-zA-Z_][a-zA-Z0-9_]*)/g;
        var positionalRe = /(^|[^:]):([0-9]+)\b/g;
        var match;

        while ((match = namedRe.exec(sanitized)) !== null) {
            named.add(match[2]);
        }
        while ((match = positionalRe.exec(sanitized)) !== null) {
            var n = parseInt(match[2], 10);
            if (!Number.isNaN(n) && n > positionalMax) {
                positionalMax = n;
            }
        }

        return { named: named, positionalMax: positionalMax };
    }

    function verifyBindParity(sql, binds) {
        var placeholders = extractBindPlaceholders(sql);
        var named = placeholders.named;
        var positionalMax = placeholders.positionalMax;

        if (named.size > 0 && positionalMax > 0) {
            throw new Error("SQL cannot mix named and positional bind placeholders");
        }
        if (named.size === 0 && positionalMax === 0) {
            return;
        }

        if (Array.isArray(binds)) {
            if (named.size > 0) {
                throw new Error("Named bind placeholders require object binds");
            }
            if (positionalMax > binds.length) {
                throw new Error("Missing positional binds for placeholders :1..:" + positionalMax + " (have " + binds.length + ")");
            }
            return;
        }

        if (binds && typeof binds === "object") {
            if (positionalMax > 0) {
                throw new Error("Positional bind placeholders require array binds");
            }
            var missing = [];
            named.forEach(function(name) {
                if (!Object.prototype.hasOwnProperty.call(binds, name)) {
                    missing.push(name);
                }
            });
            if (missing.length > 0) {
                throw new Error("Missing named binds: " + missing.join(", "));
            }
            return;
        }

        throw new Error("SQL includes bind placeholders but binds are empty");
    }

    function isAnonymousPlsqlBlock(sql) {
        return /^\s*(begin|declare)\b[\s\S]*\bend\s*;?\s*$/i.test(sql || "");
    }

    function hasEditorStatementChain(sql) {
        if (!sql || typeof sql !== "string") return false;
        if (isAnonymousPlsqlBlock(sql)) return false;
        var sanitized = stripSqlForBindScan(sql);
        var statements = sanitized.split(";").map(function(part) {
            return part.trim();
        }).filter(Boolean);
        return statements.length > 1;
    }

    function DbSqlNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.sqlSource = config.sqlSource || "editor";
        node.sqlcmd = config.sqlcmd || "";
        node.maxrows = Number(config.maxrows) || 1000;
        node.bindsSource = config.bindsSource || "editor";
        node.binds = config.binds || "";
        node.bindsMappings = [];
        node.bindsMappingExprs = [];
        node.bindsExpr = null;

        node.connection = RED.nodes.getNode(config.connection);
        if (!node.connection) {
            node.status({ fill: "red", shape: "ring", text: "no DB connection" });
            node.error("No DB Connection configured");
            return;
        }

        // "J:" prefix marks the binds field as a JSONata expression; compile once at
        // deploy time so evaluation per message is fast.
        if (node.bindsSource === "editor" && typeof node.binds === "string" &&
            (node.binds.startsWith("J:") || node.binds.startsWith("j:"))) {
            const exprText = node.binds.substring(2).trim();
            if (!exprText) {
                node.status({ fill: "red", shape: "ring", text: "invalid binds" });
                node.error("Invalid binds: JSONata expression is empty after J: prefix");
                return;
            }
            try {
                node.bindsExpr = RED.util.prepareJSONataExpression(exprText, node);
            } catch (exprErr) {
                node.status({ fill: "red", shape: "ring", text: "invalid binds" });
                node.error("Invalid binds JSONata expression: " + exprErr.message);
                return;
            }
        }

        try {
            node.bindsMappings = JSON.parse(config.bindsMappings || "[]");
        } catch (e) {
            node.bindsMappings = [];
        }
        if (!Array.isArray(node.bindsMappings)) {
            node.bindsMappings = [];
        }
        try {
            node.bindsMappingExprs = node.bindsMappings.map((mapping, i) => {
                const sourceType = mapping && mapping.sourceType || "static";
                if (sourceType !== "jsonata") return null;
                const exprText = String((mapping && mapping.value) || "").trim();
                if (!exprText) {
                    throw new Error("Invalid binds mapping at row " + (i + 1) + ": JSONata expression is empty");
                }
                try {
                    return RED.util.prepareJSONataExpression(exprText, node);
                } catch (exprErr) {
                    throw new Error("Invalid binds mapping JSONata expression at row " + (i + 1) + ": " + exprErr.message);
                }
            });
        } catch (mappingErr) {
            node.status({ fill: "red", shape: "ring", text: "invalid binds" });
            node.error(mappingErr.message);
            return;
        }

        function evaluateJsonataExpression(expr, msg) {
            return new Promise((resolve, reject) => {
                RED.util.evaluateJSONataExpression(expr, msg, (err, result) => {
                    if (err) return reject(err);
                    resolve(result);
                });
            });
        }

        function validateBindsValue(value) {
            if (value === undefined || value === null) {
                return [];
            }
            if (Array.isArray(value)) {
                return value;
            }
            if (typeof value === "object") {
                return value;
            }
            throw new Error("Binds must resolve to a JSON array or object");
        }

        function parseBooleanValue(raw) {
            const val = String(raw).trim().toLowerCase();
            if (val === "true" || val === "1" || val === "yes") return true;
            if (val === "false" || val === "0" || val === "no") return false;
            throw new Error("Boolean value must be true/false");
        }

        function parseDateValue(raw) {
            const input = String(raw).trim();
            if (!input || input.toUpperCase() === "SYSDATE") {
                return new Date();
            }
            const d = new Date(input);
            if (Number.isNaN(d.getTime())) {
                throw new Error("Date value is invalid");
            }
            return d;
        }

        async function resolveMappingValue(mapping, expr, msg) {
            const sourceType = (mapping.sourceType || "static").toLowerCase();
            const value = mapping.value || "";

            switch (sourceType) {
                case "static":
                    return value;
                case "number": {
                    const n = Number(value);
                    if (Number.isNaN(n)) {
                        throw new Error("Number value is invalid");
                    }
                    return n;
                }
                case "boolean":
                    return parseBooleanValue(value);
                case "date":
                    return parseDateValue(value);
                case "null":
                    return null;
                case "msg": {
                    if (!value || typeof value !== "string") return undefined;
                    try {
                        return RED.util.getMessageProperty(msg, value);
                    } catch (err) {
                        throw new Error("Invalid msg property path: " + err.message);
                    }
                }
                case "jsonata":
                    return await evaluateJsonataExpression(expr, msg);
                default:
                    return value;
            }
        }

        async function resolveBindsFromMappings(msg) {
            const namedBinds = {};
            for (let i = 0; i < node.bindsMappings.length; i++) {
                const mapping = node.bindsMappings[i] || {};
                const bindName = String(mapping.bindName || "").trim();
                if (!bindName) continue;
                try {
                    namedBinds[bindName] = await resolveMappingValue(mapping, node.bindsMappingExprs[i], msg);
                } catch (err) {
                    throw new Error("Invalid binds mapping at row " + (i + 1) + " (" + bindName + "): " + err.message);
                }
            }
            return namedBinds;
        }

        node.on("input", async (msg, send, done) => {
            let connection;
            let ownConnection = false;

            try {
                let sql;
                if (node.sqlSource === "msg") {
                    sql = msg.sql;
                    if (!sql || typeof sql !== "string") {
                        node.status({ fill: "red", shape: "ring", text: "no msg.sql" });
                        const err = new Error("SQL Source is set to msg.sql but msg.sql is empty or not a string");
                        node.error(err.message, msg);
                        return done(err);
                    }
                } else {
                    sql = node.sqlcmd;
                    if (!sql) {
                        node.status({ fill: "red", shape: "ring", text: "no SQL provided" });
                        const err = new Error("No SQL statement provided");
                        node.error(err.message, msg);
                        return done(err);
                    }
                }
                sql = sql.trim();

                if (node.sqlSource === "editor" && hasEditorStatementChain(sql)) {
                    const err = new Error("Editor SQL must contain exactly one statement (semicolon statement chains are not allowed)");
                    node.status({ fill: "red", shape: "ring", text: "invalid sql" });
                    node.error(err.message, msg);
                    return done(err);
                }

                let binds = [];
                if (node.bindsSource === "msg") {
                    try {
                        binds = validateBindsValue(msg.binds);
                    } catch (bindErr) {
                        node.status({ fill: "red", shape: "ring", text: "invalid binds" });
                        node.error("Invalid msg.binds: " + bindErr.message, msg);
                        return done(bindErr);
                    }
                } else if (node.bindsMappings.length > 0) {
                    binds = await resolveBindsFromMappings(msg);
                } else if (node.binds) {
                    try {
                        if (node.bindsExpr) {
                            const exprResult = await evaluateJsonataExpression(node.bindsExpr, msg);
                            binds = validateBindsValue(exprResult);
                        } else {
                            binds = validateBindsValue(JSON.parse(node.binds));
                        }
                    } catch (parseErr) {
                        node.status({ fill: "red", shape: "ring", text: "invalid binds" });
                        node.error("Invalid binds: " + parseErr.message, msg);
                        return done(parseErr);
                    }
                }

                try {
                    verifyBindParity(sql, binds);
                } catch (bindParityErr) {
                    node.status({ fill: "red", shape: "ring", text: "binds mismatch" });
                    node.error(bindParityErr.message, msg);
                    return done(bindParityErr);
                }

                let maxRows = node.maxrows;
                if (maxRows > 10000) maxRows = 10000;

                // autoCommit:false — SELECTs work fine; DML silently rolls back on
                // connection close. Callers that need to commit must use an explicit
                // COMMIT in a PL/SQL block or route through the transaction nodes.
                const options = {
                    autoCommit: false,
                    outFormat: oracledb.OUT_FORMAT_OBJECT,
                    maxRows: maxRows
                };

                node.status({ fill: "yellow", shape: "dot", text: "connecting..." });
                if (msg.transaction && msg.transaction.connection) {
                    connection = msg.transaction.connection;
                } else {
                    connection = await node.connection.getConnection();
                    ownConnection = true;
                }

                node.status({ fill: "yellow", shape: "dot", text: "executing..." });
                const res = await connection.execute(sql, binds, options);
                const rows = res.rows || [];

                node.status({ fill: "green", shape: "dot", text: `rows: ${rows.length}` });
                var outMsg = Object.assign({}, msg, {
                    payload: rows
                });
                if (msg.transaction) {
                    Object.defineProperty(outMsg, "transaction", {
                        value: msg.transaction,
                        enumerable: false,
                        writable: true,
                        configurable: true
                    });
                }
                send(outMsg);
                done();
            } catch (err) {
                node.status({ fill: "red", shape: "dot", text: "query failed" });
                msg.error = { message: err.message, code: err.errorNum || null };
                node.error(err.message, msg);
                done(err);
            } finally {
                if (connection && ownConnection) {
                    try { await connection.close(); } catch (e) {
                        node.warn("Error closing connection: " + e.message);
                    }
                }
            }
        });
    }

    RED.nodes.registerType("sql", DbSqlNode);
};

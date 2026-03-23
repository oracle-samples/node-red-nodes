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

    function DbSqlNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.sqlSource = config.sqlSource || "editor";
        node.sqlcmd = config.sqlcmd || "";
        node.maxrows = Number(config.maxrows) || 1000;
        node.binds = config.binds || "";

        node.connection = RED.nodes.getNode(config.connection);
        if (!node.connection) {
            node.status({ fill: "red", shape: "dot", text: "No DB connection" });
            node.error("No DB Connection configured");
            return;
        }

        node.on("input", async (msg, send, done) => {
            let connection;

            try {
                // Resolve SQL from editor or msg.sql
                let sql;
                if (node.sqlSource === "msg") {
                    sql = msg.sql;
                    if (!sql || typeof sql !== "string") {
                        node.status({ fill: "red", shape: "dot", text: "No msg.sql" });
                        const err = new Error("SQL Source is set to msg.sql but msg.sql is empty or not a string");
                        node.error(err.message, msg);
                        return done(err);
                    }
                } else {
                    sql = node.sqlcmd;
                    if (!sql) {
                        node.status({ fill: "red", shape: "dot", text: "No SQL provided" });
                        const err = new Error("No SQL statement provided");
                        node.error(err.message, msg);
                        return done(err);
                    }
                }
                sql = sql.trim();

                let binds = [];
                if (node.binds) {
                    try {
                        binds = JSON.parse(node.binds);
                    } catch (parseErr) {
                        node.status({ fill: "red", shape: "dot", text: "invalid binds" });
                        node.error("Invalid binds: " + parseErr.message, msg);
                        return done(parseErr);
                    }
                }

                let maxRows = node.maxrows;
                if (maxRows > 10000) maxRows = 10000;

                const options = {
                    autoCommit: false,
                    outFormat: oracledb.OUT_FORMAT_OBJECT,
                    maxRows: maxRows
                };

                node.status({ fill: "yellow", shape: "dot", text: "connecting..." });
                connection = await node.connection.getConnection();

                node.status({ fill: "yellow", shape: "dot", text: "executing..." });
                const res = await connection.execute(sql, binds, options);
                const rows = res.rows || [];

                node.status({ fill: "green", shape: "dot", text: `rows: ${rows.length}` });
                // Build a clean output message — only serializable properties
                var outMsg = {
                    _msgid: msg._msgid,
                    payload: rows,
                    result: rows
                };
                // Preserve sql property if it was set (for msg.sql source mode)
                if (msg.sql) {
                    outMsg.sql = msg.sql;
                }
                send(outMsg);
                done();
            } catch (err) {
                node.status({ fill: "red", shape: "dot", text: "error" });
                msg.error = { message: err.message, code: err.errorNum || null };
                node.error(err, msg);
                done(err);
            } finally {
                if (connection) {
                    try { await connection.close(); } catch (e) {
                        node.warn("Error closing connection: " + e.message);
                    }
                }
            }
        });
    }

    RED.nodes.registerType("sql", DbSqlNode);
};
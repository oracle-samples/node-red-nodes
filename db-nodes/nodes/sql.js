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

        node.sqlcmd   = config.sqlcmd || "";
        node.maxrows  = Number(config.maxrows) || 1000;
        node.binds = config.binds || "";

        // Get the shared db-connection config node
        node.connection = RED.nodes.getNode(config.connection);
        if (!node.connection) {
            node.status({ fill: "red", shape: "dot", text: "No DB connection" });
            node.error("No DB Connection configured");
            return;
        }

        node.on("input", async (msg, send, done) => {
            let connection;
            let sql;
            let binds;
            let maxRows = node.maxrows;

            try {
                node.status({ fill: "yellow", shape: "dot", text: "connecting..." });

                if (!node.sqlcmd) {
                    node.status({ fill: "red", shape: "dot", text: "No SQL provided" });
                    msg.error = "No SQL statement provided";
                    send(msg);
                    return done();
                }

                sql = node.sqlcmd.trim();

                if (node.binds) {
                    try {
                        binds = JSON.parse(node.binds);
                    } catch (err) {
                        node.status({ fill: "red", shape: "dot", text: "Invalid binds" });
                        msg.error = "Invalid binds: " + err;
                        node.error(err, msg);
                        return done(err);
                    }
                } else {
                    binds = [];
                }
                
                // cap maxRows to 1000
                if (maxRows > 1000) maxRows = 1000;

                // execute options
                const options = {
                    autoCommit: false,
                    outFormat: oracledb.OUT_FORMAT_OBJECT,
                    maxRows: maxRows
                };
                
                try {
                    connection = await node.connection.getConnection();
                } catch (err) {
                    node.status({ fill: "red", shape: "ring", text: "DB connect failed" });
                    node.error(err, msg);
                    return done(err);
                }

                node.status({ fill: "yellow", shape: "dot", text: "executing..." });
                
                const res = await connection.execute(sql, binds, options);
                const rows = res.rows || [];
                
                node.status({ fill: "green", shape: "dot", text: `rows: ${rows.length}` });

                send({
                    payload: rows,
                    result: rows
                });
                done();

            } catch (err) {
                node.status({ fill: "red", shape: "dot", text: "error" });
                msg.error = { message: err.message, code: err.errorNum || null };
                node.error(err, msg);
                send(msg);
                done(err);
            } finally {
                if (connection) {
                    try {
                        await connection.close();
                    } catch (err) {
                        node.warn("Error closing connection: " + err.message);
                    }
                }
            }
        });
    }

    RED.nodes.registerType("sql", DbSqlNode);
};

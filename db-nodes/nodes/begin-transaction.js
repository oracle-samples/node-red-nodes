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

module.exports = function(RED) {
    const dbError = require("../lib/db-error.js");
    var transactions = require("../lib/db-transaction.js")(RED);

    function BeginTransactionNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.timeoutSecs = Number(config.timeoutSecs) || 0;
        node.timeoutHandles = new Set();
        node.activeTransactions = new Set();
        var closing = false;
        var pendingInputs = new Set();

        function closedError() {
            var err = new Error("Transaction node is closed");
            err.code = "DB_NODE_CLOSED";
            return err;
        }

        node.connection = RED.nodes.getNode(config.connection);
        if (!node.connection) {
            node.status({ fill: "red", shape: "ring", text: "no DB connection" });
            node.error("No DB Connection configured");
            return;
        }

        function clearTrackedTimeout(handle) {
            if (!handle) return;
            clearTimeout(handle);
            node.timeoutHandles.delete(handle);
        }

        // Detach a transaction from this node's tracking. end-transaction calls
        // this (via txn._untrack) on normal completion so the timer Set and the
        // active-transaction Set do not accumulate handles across transactions.
        function untrackTransaction(txn) {
            if (!txn) return;
            clearTrackedTimeout(txn._timeout);
            txn._timeout = null;
            node.activeTransactions.delete(txn);
        }

        function scheduleTimeout(txn) {
            clearTrackedTimeout(txn._timeout);
            txn._timeout = null;

            if (node.timeoutSecs <= 0) {
                return;
            }

            var handle = setTimeout(async () => {
                node.timeoutHandles.delete(handle);
                txn._timeout = null;

                node.warn(`Transaction timed out after ${node.timeoutSecs}s — rolling back and closing connection`);
                node.status({ fill: "red", shape: "ring", text: `timed out (${node.timeoutSecs}s)` });

                try { await transactions.finish(txn, "rollback", "timeout"); } catch (err) {
                    node.warn("Timeout cleanup failed: " + dbError.redactText(err.message));
                }
            }, node.timeoutSecs * 1000);

            txn._timeout = handle;
            node.timeoutHandles.add(handle);
        }

        async function handleInput(msg, send, done) {
            try {
                if (closing) throw closedError();
                transactions.get(msg, config.connection);
                // Reuse existing transaction connection if present
                if (msg.transaction && msg.transaction.connection) {
                    var reused = msg.transaction;
                    if (typeof reused._untrack === "function") {
                        reused._untrack();
                    }
                    reused._untrack = function () { untrackTransaction(reused); };
                    node.activeTransactions.add(reused);
                    scheduleTimeout(reused);
                    node.status({ fill: "green", shape: "dot", text: "transaction reused" });
                    send(msg);
                    return done();
                }

                node.status({ fill: "yellow", shape: "dot", text: "connecting..." });
                const connection = await node.connection.getConnection();
                if (closing) {
                    try { await connection.close(); } catch (err) {
                        node.warn("Late connection cleanup failed: " + dbError.redactText(err.message));
                    }
                    throw closedError();
                }

                var txn;
                try {
                    txn = transactions.create(msg, connection, config.connection);
                } catch (err) {
                    try { await connection.close(); } catch (closeErr) { /* preserve attachment failure */ }
                    throw err;
                }

                txn._untrack = function () { untrackTransaction(txn); };
                node.activeTransactions.add(txn);
                scheduleTimeout(txn);
 
                node.status({ fill: "green", shape: "dot", text: "transaction started" });
                send(msg);
                done();
            } catch (err) {
                dbError.handleNodeError(node, msg, err, done, {
                    statusText: "DB connect failed",
                    statusShape: "dot"
                });
            }
        }

        node.on("input", function (msg, send, done) {
            var operation = handleInput(msg, send, done);
            pendingInputs.add(operation);
            operation.then(function () { pendingInputs.delete(operation); }, function () { pendingInputs.delete(operation); });
            return operation;
        });

        node.on("close", async function(done) {
            closing = true;
            // Roll back and close any transaction still open at redeploy/shutdown so
            // DB sessions and locks are not orphaned when no end-transaction runs.
            await Promise.all(Array.from(node.activeTransactions, async function (txn) {
                try { await transactions.finish(txn, "rollback", "close"); } catch (err) {
                    node.warn("Transaction cleanup failed: " + dbError.redactText(err.message));
                }
            }));
            node.activeTransactions.clear();
            await Promise.allSettled(Array.from(pendingInputs));
            node.timeoutHandles.forEach((handle) => clearTimeout(handle));
            node.timeoutHandles.clear();
            if (done) done();
        });
    }

    RED.nodes.registerType("begin-transaction", BeginTransactionNode);
};

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

    function BeginTransactionNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.timeoutSecs = Number(config.timeoutSecs) || 0;
        node.timeoutHandles = new Set();
        node.activeTransactions = new Set();

        node.connection = RED.nodes.getNode(config.connection);
        if (!node.connection) {
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
                node.activeTransactions.delete(txn);
                txn._timeout = null;

                txn.timedOut = true;
                txn.endedAt = Date.now();
                txn._ended = true;

                node.warn(`Transaction timed out after ${node.timeoutSecs}s — rolling back and closing connection`);
                node.status({ fill: "red", shape: "ring", text: `timed out (${node.timeoutSecs}s)` });

                if (txn.connection) {
                    try { await txn.connection.rollback(); } catch (e) { /* ignore */ }
                    try { await txn.connection.close(); } catch (e) { /* ignore */ }
                    txn.connection = null;
                }
            }, node.timeoutSecs * 1000);

            txn._timeout = handle;
            node.timeoutHandles.add(handle);
        }

        node.on("input", async (msg, send, done) => {
            try {
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

                // Attach transaction as non-enumerable so:
                // - Downstream nodes can still access msg.transaction.connection
                // - JSON.stringify and Socket.IO skip it
                // - Dashboard nodes can serialize msg without errors
                // - Debug nodes show a cleaner output
                var txn = {
                    connection: connection,
                    startedAt: Date.now(),
                    msgId: msg._msgid
                };
 
                Object.defineProperty(msg, 'transaction', {
                    value: txn,
                    enumerable: false,
                    writable: true,
                    configurable: true
                });

                txn._untrack = function () { untrackTransaction(txn); };
                node.activeTransactions.add(txn);
                scheduleTimeout(txn);
 
                node.status({ fill: "green", shape: "dot", text: "transaction started" });
                send(msg);
                done();
            } catch (err) {
                dbError.handleNodeError(node, msg, err, done, {
                    statusText: "DB connect failed",
                    statusShape: "ring"
                });
            }
        });

        node.on("close", async function(done) {
            // Roll back and close any transaction still open at redeploy/shutdown so
            // DB sessions and locks are not orphaned when no end-transaction runs.
            for (const txn of node.activeTransactions) {
                clearTrackedTimeout(txn._timeout);
                txn._timeout = null;
                txn._ended = true;
                if (txn.connection) {
                    try { await txn.connection.rollback(); } catch (e) { /* ignore */ }
                    try { await txn.connection.close(); } catch (e) { /* ignore */ }
                    txn.connection = null;
                }
            }
            node.activeTransactions.clear();
            node.timeoutHandles.forEach((handle) => clearTimeout(handle));
            node.timeoutHandles.clear();
            if (done) done();
        });
    }

    RED.nodes.registerType("begin-transaction", BeginTransactionNode);
};

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

    function EndTransactionNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // "commit" (default) or "rollback"
        node.action = config.action || "commit";
        if (node.action !== "commit" && node.action !== "rollback") {
            node.warn("Unknown action '" + node.action + "', defaulting to commit");
        }

        node.on("input", async (msg, send, done) => {
            const action = node.action === "rollback" ? "rollback" : "commit";
            var elapsed = "?";
            try {
                var txn = transactions.get(msg);
                if (!txn) {
                    node.status({ fill: "red", shape: "ring", text: "no transaction" });
                    send(msg);
                    return done();
                }
                elapsed = ((Date.now() - txn.startedAt) / 1000).toFixed(1);
                node.status({ fill: "yellow", shape: "dot", text: action === "rollback" ? "rolling back..." : "committing..." });
                await transactions.finish(txn, action);
                delete msg.transaction;
                delete msg._dbTransaction;

                if (action === "rollback") {
                    node.status({ fill: "yellow", shape: "dot", text: `rolled back (${elapsed}s)` });
                } else {
                    node.status({ fill: "green", shape: "dot", text: `committed (${elapsed}s)` });
                }

                send(msg);
                done();
            } catch (err) {
                delete msg.transaction;
                dbError.handleNodeError(node, msg, err, done, { statusText: `${action} failed (${elapsed}s)` });
            }
        });
    }

    RED.nodes.registerType("end-transaction", EndTransactionNode);
};

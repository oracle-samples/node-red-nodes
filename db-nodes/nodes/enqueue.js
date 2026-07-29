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
    const oracledb = require("oracledb");
    const dbError = require("../lib/db-error.js");
    const oracleAq = require("../lib/oracle-aq.js");

    function DbEnqueueNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.queueName = config.queueName;
        node.recipients = config.recipients || null;
        node.userPayload = config.userPayload;
        node.enableOutput = config.enableOutput !== false;
        node.deliveryMode = config.deliveryMode || "persistent";
        node.payloadType = config.payloadType || "json";
        node.adtTypeName = config.adtTypeName || "";

        node.connection = RED.nodes.getNode(config.connection);
        if (!node.connection) {
            node.error("No DB Connection configured");
            return;
        }

        node.on("input", async (msg, send, done) => {
            let connection;
            let ownConnection = false;
            let arr;

            try {
                node.status({ fill: "yellow", shape: "dot", text: "enqueueing..." });
                if (msg.transaction && msg.transaction.connection) {
                    connection = msg.transaction.connection;
                } else {
                    connection = await node.connection.getConnection();
                    ownConnection = true;
                }

                try {
                    arr = oracleAq.normalizeEnqueuePayload(node.payloadType, node.userPayload, msg.payload);
                } catch (parseErr) {
                    return dbError.handleNodeError(node, msg, parseErr, done, {
                        statusText: "invalid payload",
                        statusShape: "ring"
                    });
                }

                const queuePayloadType = oracleAq.resolveQueuePayloadType(oracledb, node.payloadType, node.adtTypeName);

                const queue = await connection.getQueue(node.queueName, {
                    payloadType: queuePayloadType,
                });

                oracleAq.configureEnqueueQueue(queue, oracledb, node);

                var messages = oracleAq.createEnqueueMessages(node.payloadType, queue, arr);

                await queue.enqMany(messages);
                if (ownConnection) {
                    // AQ enqueueMany is not auto-committed — messages stay invisible to
                    // consumers until explicitly committed.
                    await connection.commit();
                }

                node.status({ fill: "green", shape: "dot", text: `enqueued ${messages.length}` });
                if (node.enableOutput) {
                    var outMsg = Object.assign({}, msg, {
                        count: messages.length
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
                }
                done();
            } catch (err) {
                dbError.handleNodeError(node, msg, err, done, { statusText: "enqueue failed" });
            } finally {
                if (connection && ownConnection) {
                    try { await connection.close(); } catch (e) {
                        node.warn(`Failed to close connection: ${dbError.redactText(e.message)}`);
                    }
                }
            }
        });
    }

    RED.nodes.registerType("enqueue", DbEnqueueNode);
};

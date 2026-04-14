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
    const RETRY_WARN_THROTTLE_MS = 30000;
    const DEFAULT_RETRY_DELAY_MS = 5000;

    // Map config values to oracledb constants.
    const DEQ_MODES = {
        "remove":  oracledb.AQ_DEQ_MODE_REMOVE,
        "browse":  oracledb.AQ_DEQ_MODE_BROWSE,
        "locked":  oracledb.AQ_DEQ_MODE_LOCKED
    };

    // Convert Oracle DbObject payloads to plain JS objects.
    // Non-ADT values pass through unchanged.
    function dbObjectToPojo(obj) {
        if (obj && obj._objType && obj._objType.attributes) {
            const result = {};
            for (const attr of obj._objType.attributes) {
                const val = obj[attr.name];
                result[attr.name] = (val && val._objType && val._objType.attributes)
                    ? dbObjectToPojo(val) : val;
            }
            return result;
        }
        return obj;
    }

    function DbDequeueNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.queueName = config.queueName;
        node.subscriber = config.subscriber || null;
        node.batchSize = Number(config.batchSize) || 1;
        node.deqMode = config.deqMode || "remove";
        node.mode = config.mode || "transactional";
        node.wait = Number(config.wait) || 0;
        node.waitForever = !!config.waitForever;
        node.payloadType = config.payloadType || "json";
        node.adtTypeName = config.adtTypeName || "";
        node.retryEnabled = config.retryEnabled !== false;
        node.retryDelayMs = Number(config.retryDelayMs);
        if (!Number.isFinite(node.retryDelayMs) || node.retryDelayMs < 0) {
            node.retryDelayMs = DEFAULT_RETRY_DELAY_MS;
        }
        node.maxRetries = Number(config.maxRetries);
        if (!Number.isFinite(node.maxRetries) || node.maxRetries < 0) {
            node.maxRetries = 0;
        } else {
            node.maxRetries = Math.floor(node.maxRetries);
        }

        const queuePayloadType = node.payloadType === "adt" ? node.adtTypeName.toUpperCase()
            : node.payloadType === "raw" ? oracledb.DB_TYPE_RAW
            : oracledb.DB_TYPE_JSON;

        node.connection = RED.nodes.getNode(config.connection);
        if (!node.connection) {
            node.error("No DB Connection configured");
            return;
        }

        // ─── TRANSACTIONAL MODE ───────────────────────────────────────────────
        // Triggered by incoming msg. Supports begin-transaction / end-transaction.
        // Falls back to a standalone connection with auto-commit when no transaction
        // is present on msg.
        if (node.mode === "transactional") {
            node.on("input", async function (msg, send, done) {
                var connection = null;
                var ownConnection = false;

                try {
                    if (msg.transaction && msg.transaction.connection) {
                        connection = msg.transaction.connection;
                    } else {
                        connection = await node.connection.getConnection();
                        ownConnection = true;
                    }

                    const queue = await connection.getQueue(node.queueName, {
                        payloadType: queuePayloadType,
                    });

                    if (node.subscriber) queue.deqOptions.consumerName = node.subscriber;
                    queue.deqOptions.mode = DEQ_MODES[node.deqMode] || oracledb.AQ_DEQ_MODE_REMOVE;
                    queue.deqOptions.visibility = oracledb.AQ_VISIBILITY_ON_COMMIT;
                    queue.deqOptions.wait = node.waitForever
                        ? oracledb.AQ_DEQ_WAIT_FOREVER
                        : node.wait;

                    const messages = await queue.deqMany(node.batchSize);

                    // Read and normalize payloads before closing the connection.
                    const payloads = messages ? messages.map(m => dbObjectToPojo(m.payload)) : [];

                    if (ownConnection) {
                        await connection.commit();
                        await connection.close();
                        connection = null;
                    }

                    if (payloads.length === 0) {
                        node.status({ fill: "grey", shape: "dot", text: "no messages" });
                    }

                    for (const payload of payloads) {
                        var outMsg = Object.assign({}, msg, {
                            payload: payload,
                            dequeued: payload
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
                    if (connection && ownConnection) {
                        try { await connection.close(); } catch (e) {}
                    }
                    done(err);
                }
            });
        }

        // ─── CONTINUOUS MODE ──────────────────────────────────────────────────
        // Starts on deploy. Opens a persistent connection and loops indefinitely
        // with AQ_DEQ_WAIT_FOREVER. Commits immediately after each batch — no
        // rollback protection. Mirrors the MQTT In pattern.
        if (node.mode === "continuous") {
            let running = false;
            let connection = null;
            let listenerPromise = null;
            let retryTimer = null;
            let retrySleepResolve = null;
            let retryAttempt = 0;
            let lastRetryWarnAt = 0;

            // Interruptible sleep — stores resolve so the close handler can wake the loop early.
            function sleep(ms) {
                return new Promise((resolve) => {
                    if (!running) return resolve(false);
                    retrySleepResolve = resolve;
                    retryTimer = setTimeout(() => {
                        retryTimer = null;
                        const done = retrySleepResolve;
                        retrySleepResolve = null;
                        done(true);
                    }, ms);
                });
            }

            async function closeConnection() {
                if (!connection) return;
                try { await connection.close(); } catch (e) {}
                connection = null;
            }

            function shouldRetry() {
                if (!node.retryEnabled) return false;
                if (node.maxRetries === 0) return true;
                return retryAttempt <= node.maxRetries;
            }

            function warnRetry(err) {
                const now = Date.now();
                if (retryAttempt === 1 || now - lastRetryWarnAt >= RETRY_WARN_THROTTLE_MS) {
                    lastRetryWarnAt = now;
                    const retryLimitText = node.maxRetries === 0 ? "unlimited" : String(node.maxRetries);
                    node.warn(
                        `Continuous dequeue error: ${err.message}. Retrying in ${node.retryDelayMs}ms (attempt ${retryAttempt}, max ${retryLimitText}).`
                    );
                }
            }

            function setTerminalError(err, reason) {
                const text = reason || err.message || "failed";
                node.status({ fill: "red", shape: "dot", text: text });
                node.error(`Continuous dequeue stopped: ${text}`);
            }

            async function startListening() {
                running = true;
                while (running) {
                    try {
                        node.status({ fill: "yellow", shape: "dot", text: "connecting..." });
                        connection = await node.connection.getConnection();

                        const queue = await connection.getQueue(node.queueName, {
                            payloadType: queuePayloadType,
                        });
                        if (node.subscriber) queue.deqOptions.consumerName = node.subscriber;
                        queue.deqOptions.wait = oracledb.AQ_DEQ_WAIT_FOREVER;
                        queue.deqOptions.mode = DEQ_MODES[node.deqMode] || oracledb.AQ_DEQ_MODE_REMOVE;
                        queue.deqOptions.visibility = oracledb.AQ_VISIBILITY_ON_COMMIT;

                        retryAttempt = 0;
                        node.status({ fill: "green", shape: "ring", text: "listening" });

                        while (running) {
                            const messages = await queue.deqMany(node.batchSize);
                            if (!running) {
                                break;
                            }

                            if (messages && messages.length > 0) {
                                await connection.commit();
                                node.status({ fill: "green", shape: "dot", text: `dequeued ${messages.length}` });
                                for (const m of messages) {
                                    const payload = dbObjectToPojo(m.payload);
                                    node.send({
                                        _msgid: RED.util.generateId(),
                                        dequeued: payload,
                                        payload: payload
                                    });
                                }
                                node.status({ fill: "green", shape: "ring", text: "listening" });
                            }
                        }
                    } catch (err) {
                        if (!running) {
                            break;
                        }

                        await closeConnection();

                        retryAttempt += 1;
                        if (!shouldRetry()) {
                            const reason = node.retryEnabled
                                ? `retries exhausted at attempt ${retryAttempt}: ${err.message}`
                                : err.message;
                            setTerminalError(err, reason);
                            break;
                        }

                        node.status({ fill: "yellow", shape: "ring", text: `retrying (attempt ${retryAttempt})` });
                        warnRetry(err);
                        const shouldContinue = await sleep(node.retryDelayMs);
                        if (!shouldContinue || !running) {
                            break;
                        }
                    } finally {
                        await closeConnection();
                    }
                }
            }

            node.on("close", async (done) => {
                running = false;
                if (retryTimer) {
                    clearTimeout(retryTimer);
                    retryTimer = null;
                }
                if (retrySleepResolve) {
                    const done = retrySleepResolve;
                    retrySleepResolve = null;
                    done(false);
                }
                // break() interrupts the in-flight deqMany(AQ_DEQ_WAIT_FOREVER) at the Oracle level.
                if (connection) {
                    try { await connection.break(); } catch (e) {}
                }
                if (listenerPromise) {
                    try { await listenerPromise; } catch (e) {}
                }
                await closeConnection();
                node.status({});
                done();
            });

            listenerPromise = startListening();
        }
    }

    RED.nodes.registerType("dequeue", DbDequeueNode);
};

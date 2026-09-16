/* Copyright (c) 2026 Oracle and/or its affiliates.
 * Licensed under the Universal Permissive License (UPL), Version 1.0.
 * https://oss.oracle.com/licenses/upl/
 */
var crypto = require("crypto");
var runtimes = new WeakMap();

module.exports = function (RED) {
    // Node-RED creates an API wrapper per module but shares the runtime lookup function.
    var runtime = RED.nodes.getNode;
    if (runtimes.has(runtime)) return runtimes.get(runtime);
    var transactions = new Map();

    function inactive() {
        var err = new Error("Transaction is inactive; start a new transaction before retrying");
        err.code = "DB_TRANSACTION_INACTIVE";
        return err;
    }

    function attach(msg, txn) {
        msg._dbTransaction = txn.id;
        Object.defineProperty(msg, "transaction", {
            value: txn, enumerable: false, writable: true, configurable: true
        });
    }

    function get(msg, configId) {
        if (!Object.prototype.hasOwnProperty.call(msg, "_dbTransaction")) {
            if (msg.transaction !== undefined && msg.transaction !== null) throw inactive();
            return null;
        }
        var txn = transactions.get(msg._dbTransaction);
        if (!txn || txn._state !== "active" || !txn.connection) throw inactive();
        if (configId !== undefined && configId !== txn.configId) {
            var err = new Error("Transaction belongs to a different DB Connection");
            err.code = "DB_TRANSACTION_CONFIG_MISMATCH";
            throw err;
        }
        attach(msg, txn);
        return txn;
    }

    function create(msg, connection, configId) {
        var txn = {
            id: crypto.randomBytes(32).toString("hex"),
            configId: configId,
            connection: connection,
            startedAt: Date.now(),
            msgId: msg._msgid,
            _state: "active",
            _tail: Promise.resolve()
        };
        attach(msg, txn);
        transactions.set(txn.id, txn);
        return txn;
    }

    async function acquire(msg, configId) {
        var txn = get(msg, configId);
        if (!txn) return null;
        var previous = txn._tail;
        var release;
        txn._tail = new Promise(function (resolve) { release = resolve; });
        await previous;
        if (txn._state !== "active") {
            release();
            throw inactive();
        }
        return { transaction: txn, release: release };
    }

    function finish(txn, action, reason) {
        if (txn._completion) return txn._completion;
        txn._state = "ending";
        if (reason === "timeout") txn.timedOut = true;
        if (txn._timeout) clearTimeout(txn._timeout);
        // Stop admission before waiting: closing a connection must not race DB work.
        txn._completion = (async function () {
            await txn._tail;
            txn._ended = true;
            txn.endedAt = Date.now();
            var failure;
            if (action === "commit" && txn._rollbackOnly) {
                action = "rollback";
                failure = new Error("Transaction contains failed DB work and must be rolled back");
                failure.code = "DB_TRANSACTION_ROLLBACK_REQUIRED";
            }
            try {
                await txn.connection[action]();
            } catch (err) {
                failure = err;
                if (action === "commit") {
                    try { await txn.connection.rollback(); } catch (rollbackErr) { /* preserve commit failure */ }
                }
            }
            try {
                await txn.connection.close();
            } catch (err) {
                if (!failure) failure = err;
            } finally {
                txn.connection = null;
                txn._state = "ended";
                transactions.delete(txn.id);
                if (typeof txn._untrack === "function") txn._untrack();
            }
            if (failure) throw failure;
        })();
        return txn._completion;
    }

    var registry = { create: create, get: get, acquire: acquire, finish: finish };
    runtimes.set(runtime, registry);
    return registry;
};

const test = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const Module = require("node:module");
const path = require("node:path");

function loadSqlNode(executeResult, sqlcmd) {
    var registeredConstructor;
    var executeCalls = 0;
    var connection = {
        execute: async function () {
            executeCalls++;
            return executeResult;
        },
        close: async function () {}
    };
    var dbConnection = {
        getConnection: async function () {
            return connection;
        }
    };
    var RED = {
        nodes: {
            createNode: function (node) {
                EventEmitter.call(node);
                Object.setPrototypeOf(node, EventEmitter.prototype);
                node.statuses = [];
                node.errors = [];
                node.warnings = [];
                node.status = function (status) { node.statuses.push(status); };
                node.error = function (message) { node.errors.push(message); };
                node.warn = function (message) { node.warnings.push(message); };
            },
            registerType: function (name, constructor) {
                if (name === "sql") registeredConstructor = constructor;
            },
            getNode: function () {
                return dbConnection;
            }
        },
        util: {
            prepareJSONataExpression: function () {},
            evaluateJSONataExpression: function () {},
            getMessageProperty: function (msg, property) {
                return msg[property];
            }
        }
    };
    var fakeOracledb = {
        OUT_FORMAT_OBJECT: 4002
    };
    var originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (request === "oracledb") return fakeOracledb;
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        var nodePath = path.join(__dirname, "..", "nodes", "sql.js");
        delete require.cache[require.resolve(nodePath)];
        require(nodePath)(RED);
    } finally {
        Module._load = originalLoad;
    }

    var node = new registeredConstructor({
        connection: "db-config",
        sqlSource: "editor",
        sqlcmd: sqlcmd === undefined ? "BEGIN NULL; END;" : sqlcmd,
        bindsSource: "editor",
        binds: "",
        bindsMappings: "[]",
        maxrows: 1000
    });
    node.getTestExecuteCalls = function () {
        return executeCalls;
    };
    return node;
}

function invokeNode(node, msg) {
    return new Promise(function (resolve) {
        var sent;
        node.emit("input", msg, function (outMsg) {
            sent = outMsg;
        }, function (err) {
            resolve({ sent: sent, err: err });
        });
    });
}

test("sql reports returned rows with additive success metadata", async function () {
    var node = loadSqlNode({ rows: [{ VALUE: 1 }] });
    var result = await invokeNode(node, { correlationId: "row-test" });

    assert.equal(result.err, undefined);
    assert.deepEqual(result.sent.payload, [{ VALUE: 1 }]);
    assert.deepEqual(result.sent.dbResult, {
        success: true,
        rowsReturned: 1,
        rowsAffected: null
    });
    assert.equal(result.sent.correlationId, "row-test");
    assert.equal(node.statuses.at(-1).text, "rows: 1");
});

test("sql reports affected rows for successful DML without changing payload type", async function () {
    var node = loadSqlNode({ rowsAffected: 2 });
    var result = await invokeNode(node, {});

    assert.equal(result.err, undefined);
    assert.deepEqual(result.sent.payload, []);
    assert.deepEqual(result.sent.dbResult, {
        success: true,
        rowsReturned: 0,
        rowsAffected: 2
    });
    assert.equal(node.statuses.at(-1).text, "affected: 2");
});

test("sql reports completed for successful PL/SQL without rows", async function () {
    var transactionConnection = {
        execute: async function () {
            return {};
        }
    };
    var transaction = {
        connection: transactionConnection
    };
    var msg = {};
    Object.defineProperty(msg, "transaction", {
        value: transaction,
        enumerable: false,
        writable: true,
        configurable: true
    });
    var node = loadSqlNode({});
    var result = await invokeNode(node, msg);

    assert.equal(result.err, undefined);
    assert.deepEqual(result.sent.payload, []);
    assert.deepEqual(result.sent.dbResult, {
        success: true,
        rowsReturned: 0,
        rowsAffected: null
    });
    assert.equal(node.statuses.at(-1).text, "completed");
    assert.equal(result.sent.transaction, transaction);
    assert.equal(Object.prototype.propertyIsEnumerable.call(result.sent, "transaction"), false);
});

test("sql identifies a trailing SQLcl terminator", async function () {
    var node = loadSqlNode({}, "BEGIN\n  NULL;\nEND;\n/");
    var msg = {};
    var result = await invokeNode(node, msg);

    assert.equal(result.sent, undefined);
    assert.equal(
        result.err.message,
        "SQLcl/SQL*Plus terminator \"/\" is not supported. Remove the trailing \"/\" and execute the PL/SQL block ending with END;"
    );
    assert.deepEqual(node.statuses.at(-1), {
        fill: "red",
        shape: "ring",
        text: "invalid sql"
    });
    assert.deepEqual(msg.error, {
        message: result.err.message,
        code: null
    });
    assert.equal(node.errors.at(-1), result.err.message);
    assert.equal(node.getTestExecuteCalls(), 0);
});

test("sql accepts an anonymous PL/SQL block without a client terminator", async function () {
    var node = loadSqlNode({}, "BEGIN\n  NULL;\nEND;");
    var result = await invokeNode(node, {});

    assert.equal(result.err, undefined);
    assert.deepEqual(result.sent.payload, []);
    assert.equal(node.statuses.at(-1).text, "completed");
});

test("sql retains the statement-chain error for multiple SQL statements", async function () {
    var node = loadSqlNode({}, "SELECT 1 FROM DUAL; SELECT 2 FROM DUAL");
    var result = await invokeNode(node, {});

    assert.equal(result.sent, undefined);
    assert.equal(
        result.err.message,
        "Editor SQL must contain exactly one statement (semicolon statement chains are not allowed)"
    );
});

test("sql does not treat an arithmetic slash as a client terminator", async function () {
    var node = loadSqlNode({ rows: [{ VALUE: 2 }] }, "SELECT 4 / 2 AS VALUE FROM DUAL");
    var result = await invokeNode(node, {});

    assert.equal(result.err, undefined);
    assert.deepEqual(result.sent.payload, [{ VALUE: 2 }]);
});

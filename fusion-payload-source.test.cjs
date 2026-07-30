const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const scmMapping = require(path.join(
    __dirname,
    "fusion-scm-nodes",
    "lib",
    "scm-mapping.js"
));

const RED = {
    util: {
        getMessageProperty: function (msg, property) {
            return String(property || "").split(".").reduce(function (value, part) {
                return value === undefined || value === null ? undefined : value[part];
            }, msg);
        }
    }
};

function captureError(callback) {
    try {
        callback();
    } catch (error) {
        return error;
    }
    assert.fail("expected callback to throw");
}

test("missing payload source preserves mapped-fields behavior", function () {
    var mappings = [
        {
            scmField: "AssetNumber",
            sourceType: "msg",
            value: "payload.AssetNumber"
        }
    ];

    var resolved = scmMapping.resolveRequestPayload(undefined, mappings, {
        payload: { AssetNumber: "ASSET-100" }
    }, RED);

    assert.deepEqual(resolved, { AssetNumber: "ASSET-100" });
});

test("mapped source rejects an empty mapping result instead of using msg.payload", function () {
    var error = captureError(function () {
        scmMapping.resolveRequestPayload("mappings", [], {
            payload: { AssetNumber: "ASSET-IGNORED" }
        }, RED);
    });

    assert.match(error.message, /Mapped fields requires at least one payload mapping/);
    assert.equal(error.scmPayloadValidationError, true);
});

test("mapped source permits an empty result only for an explicitly bodyless request", function () {
    var resolved = scmMapping.resolveRequestPayload("mappings", [], {
        payload: { AssetNumber: "ASSET-IGNORED" }
    }, RED, {
        allowEmptyMappedPayload: true
    });

    assert.deepEqual(resolved, {});
});

test("msgPayload source returns an independent copy of the entire logical payload", function () {
    var input = {
        AssetNumber: "ASSET-200",
        readings: [
            { MeterCode: "TEMP", ReadingValue: 72 }
        ]
    };
    var mappings = [
        {
            scmField: "Ignored",
            sourceType: "static",
            value: "mapping"
        }
    ];

    var resolved = scmMapping.resolveRequestPayload("msgPayload", mappings, {
        payload: input
    }, RED);

    assert.deepEqual(resolved, input);
    assert.notEqual(resolved, input);
    assert.notEqual(resolved.readings, input.readings);
    assert.notEqual(resolved.readings[0], input.readings[0]);

    resolved.readings[0].ReadingValue = 73;
    assert.equal(input.readings[0].ReadingValue, 72);
    assert.equal(resolved.Ignored, undefined);
});

test("msgPayload source requires a plain object at the root", function () {
    [null, undefined, "payload", 1, true, []].forEach(function (payload) {
        var error = captureError(function () {
            scmMapping.resolveRequestPayload("msgPayload", [], { payload: payload }, RED);
        });
        assert.match(error.message, /msg\.payload must be a plain JSON object/);
        assert.equal(error.scmPayloadValidationError, true);
    });
});

test("msgPayload source rejects unsupported JSON values", function () {
    var invalidPayloads = [
        { value: undefined },
        { value: function () {} },
        { value: Symbol("value") },
        { value: BigInt(1) },
        { value: Number.NaN },
        { value: Number.POSITIVE_INFINITY },
        { value: new Date("2026-07-29T00:00:00Z") }
    ];
    var circular = {};
    circular.self = circular;
    invalidPayloads.push(circular);

    invalidPayloads.forEach(function (payload) {
        var error = captureError(function () {
            scmMapping.resolveRequestPayload("msgPayload", [], { payload: payload }, RED);
        });
        assert.match(error.message, /msg\.payload contains an unsupported JSON value/);
        assert.equal(error.scmPayloadValidationError, true);
    });
});

test("msgPayload source rejects prototype-sensitive keys at any depth", function () {
    var dangerousPayloads = [
        JSON.parse('{"__proto__":{"polluted":true}}'),
        { nested: { constructor: { value: true } } },
        { nested: [{ prototype: { value: true } }] }
    ];

    dangerousPayloads.forEach(function (payload) {
        var error = captureError(function () {
            scmMapping.resolveRequestPayload("msgPayload", [], { payload: payload }, RED);
        });
        assert.match(error.message, /msg\.payload contains a prohibited key/);
        assert.equal(error.scmPayloadValidationError, true);
    });
});

test("unknown payload source is rejected", function () {
    var error = captureError(function () {
        scmMapping.resolveRequestPayload("unknown", [], { payload: {} }, RED);
    });
    assert.match(error.message, /Payload Source must be mappings or msgPayload/);
    assert.equal(error.scmPayloadValidationError, true);
});

test("every mapped action runtime uses the mode-aware payload resolver", function () {
    var runtimeFiles = [
        "nodes/create-asset.js",
        "nodes/create-meter-reading.js",
        "nodes/fusion-request.js",
        "nodes/misc-transaction.js",
        "nodes/subinventory-quantity-transfer.js",
        "nodes/maintenance-work-order.js",
        "nodes/manufacturing-work-order.js",
        "nodes/manufacturing-production-transaction.js",
        "lib/work-order-child-node.js"
    ];

    runtimeFiles.forEach(function (relativePath) {
        var source = fs.readFileSync(path.join(
            __dirname,
            "fusion-scm-nodes",
            relativePath
        ), "utf8");
        if (relativePath === "nodes/fusion-request.js") {
            assert.match(
                source,
                /resolveRequestPayload\([\s\S]*?config\.payloadSource,[\s\S]*?mappings,[\s\S]*?msg,[\s\S]*?RED,[\s\S]*?\{[\s\S]*?allowEmptyMappedPayload:/,
                relativePath + " must explicitly identify bodyless methods"
            );
            return;
        }
        assert.match(
            source,
            /resolveRequestPayload\(config\.payloadSource, mappings, msg, RED\)/,
            relativePath + " must resolve the configured payload source"
        );
    });
});

test("every mapped action editor exposes mutually exclusive payload sources", function () {
    var editorFiles = [
        "create-asset.html",
        "create-meter-reading.html",
        "fusion-request.html",
        "misc-transaction.html",
        "subinventory-quantity-transfer.html",
        "maintenance-work-order.html",
        "manufacturing-work-order.html",
        "manufacturing-production-transaction.html",
        "maintenance-work-order-child.html",
        "manufacturing-work-order-child.html"
    ];

    editorFiles.forEach(function (fileName) {
        var source = fs.readFileSync(path.join(
            __dirname,
            "fusion-scm-nodes",
            "nodes",
            fileName
        ), "utf8");
        assert.match(
            source,
            /payloadSource:\s*\{\s*value:\s*"mappings"\s*\}/,
            fileName + " must default to mapped fields"
        );
        assert.match(source, /id="node-input-payloadSource"/);
        assert.match(source, /<option value="mappings">Mapped fields<\/option>/);
        assert.match(source, /<option value="msgPayload">Entire msg\.payload<\/option>/);
        assert.match(
            source,
            /class="scm-payload-mappings"/,
            fileName + " must mark the mappings section for conditional display"
        );
        assert.equal(
            (source.match(/id="node-input-mappings"/g) || []).length,
            1,
            fileName + " must expose exactly one persisted mappings input"
        );
        assert.match(
            source,
            /node-input-payloadSource.*change/,
            fileName + " must react to payload-source changes"
        );
    });
});

test("every mapped action runtime classifies direct-payload failures as input validation", function () {
    var runtimeFiles = [
        "nodes/create-asset.js",
        "nodes/create-meter-reading.js",
        "nodes/fusion-request.js",
        "nodes/misc-transaction.js",
        "nodes/subinventory-quantity-transfer.js",
        "nodes/maintenance-work-order.js",
        "nodes/manufacturing-work-order.js",
        "nodes/manufacturing-production-transaction.js",
        "lib/work-order-child-node.js"
    ];

    runtimeFiles.forEach(function (relativePath) {
        var source = fs.readFileSync(path.join(
            __dirname,
            "fusion-scm-nodes",
            relativePath
        ), "utf8");
        assert.match(
            source,
            /scmPayloadValidationError/,
            relativePath + " must report direct-payload validation consistently"
        );
    });
});

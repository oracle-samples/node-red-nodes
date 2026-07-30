const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const FUSION_HOST = "fusion.example.test";
const API_VERSION = "11.13.18.05";
const RESOURCE_ROOT = "https://" + FUSION_HOST + "/fscmRestApi/resources/" + API_VERSION;

function messageProperty(msg, property) {
    return String(property || "").split(".").reduce(function (value, part) {
        return value === undefined || value === null ? undefined : value[part];
    }, msg);
}

function loadFusionRequest(configOverrides) {
    var axiosCalls = [];
    var tokenCalls = 0;
    var registeredConstructor;
    var events = [];
    var server = {
        hostname: FUSION_HOST,
        version: API_VERSION,
        proxyUrl: "",
        useProxy: false,
        getToken: async function () {
            events.push("token");
            tokenCalls++;
            return "test-token";
        },
        buildUrl: function (endpoint) {
            return RESOURCE_ROOT + "/" + String(endpoint || "");
        }
    };
    var fakeAxios = async function (options) {
        events.push("axios");
        axiosCalls.push(options);
        return {
            status: 200,
            data: { accepted: true }
        };
    };
    var RED = {
        nodes: {
            createNode: function (node) {
                EventEmitter.call(node);
                Object.setPrototypeOf(node, EventEmitter.prototype);
                node.statuses = [];
                node.errors = [];
                node.status = function (status) {
                    node.statuses.push(status);
                };
                node.error = function (message) {
                    node.errors.push(message);
                };
            },
            getNode: function () {
                return server;
            },
            registerType: function (name, constructor) {
                if (name === "fusion-request") registeredConstructor = constructor;
            }
        },
        util: {
            getMessageProperty: messageProperty
        }
    };
    var originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (request === "axios") return fakeAxios;
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        var nodePath = path.join(
            __dirname,
            "fusion-scm-nodes",
            "nodes",
            "fusion-request.js"
        );
        delete require.cache[require.resolve(nodePath)];
        require(nodePath)(RED);
    } finally {
        Module._load = originalLoad;
    }

    var config = Object.assign({
        server: "scm-server",
        transactionType: "custom",
        method: "POST",
        requestMediaType: "resourceItem",
        customPath: RESOURCE_ROOT + "/meterReadings",
        mappings: "[]"
    }, configOverrides || {});
    var node = new registeredConstructor(config);

    return {
        node: node,
        axiosCalls: axiosCalls,
        events: events,
        getTokenCalls: function () {
            return tokenCalls;
        }
    };
}

function invokeNode(node, msg) {
    return new Promise(function (resolve) {
        var sent;
        node.emit("input", msg || {}, function (outMsg) {
            sent = outMsg;
        }, function (err) {
            resolve({ sent: sent, err: err });
        });
    });
}

function assertRejectedBeforeAuthentication(harness, result, expected) {
    assert.ok(result.err, "expected the request to be rejected");
    assert.match(result.err.message, expected);
    assert.equal(harness.getTokenCalls(), 0);
    assert.equal(harness.axiosCalls.length, 0);
}

function batchMappings() {
    return JSON.stringify([
        {
            scmField: "parts",
            sourceType: "msg",
            value: "payload.parts"
        }
    ]);
}

function validBatchPart() {
    return {
        id: "temperature-reading",
        path: "/meterReadings",
        operation: "create",
        payload: {
            AssetNumber: "TEST-ASSET-01",
            MeterCode: "TEMPERATURE",
            ReadingValue: 74
        }
    };
}

function encodeRepeatedly(value, count) {
    var encoded = value;
    for (var i = 0; i < count; i++) {
        encoded = encodeURIComponent(encoded);
    }
    return encoded;
}

test("fusion request editor exposes the four fixed request media types", function () {
    var html = fs.readFileSync(
        path.join(__dirname, "fusion-scm-nodes", "nodes", "fusion-request.html"),
        "utf8"
    );
    var expectedOptions = [
        ['resourceItem', "ADF Resource Item"],
        ['adfAction', "ADF Action"],
        ['json', "JSON"],
        ['adfBatch', "ADF Batch"]
    ];

    expectedOptions.forEach(function (expected) {
        assert.match(
            html,
            new RegExp(
                '<option value="' + expected[0] + '">' + expected[1] + "</option>"
            )
        );
    });
});

test("JSON requests stay inside the configured SCM hierarchy and disable redirects", async function () {
    var harness = loadFusionRequest({
        requestMediaType: "json",
        customPath: RESOURCE_ROOT + "/validateCorrectedQuantities",
        mappings: JSON.stringify([
            {
                scmField: "Quantity",
                sourceType: "msg",
                value: "payload.Quantity"
            },
            {
                scmField: "ParentTransactionId",
                sourceType: "msg",
                value: "payload.ParentTransactionId"
            }
        ])
    });
    var input = {
        payload: {
            Quantity: 1,
            ParentTransactionId: 123
        }
    };
    var result = await invokeNode(harness.node, input);

    assert.equal(result.err, undefined);
    assert.equal(harness.getTokenCalls(), 1);
    assert.deepEqual(harness.events, ["token", "axios"]);
    assert.equal(harness.axiosCalls.length, 1);
    assert.equal(harness.axiosCalls[0].method, "post");
    assert.deepEqual(harness.axiosCalls[0].data, {
        Quantity: 1,
        ParentTransactionId: 123
    });
    assert.equal(harness.axiosCalls[0].maxRedirects, 0);
    assert.equal(harness.axiosCalls[0].headers["Content-Type"], "application/json");
});

test("Entire msg.payload mode sends a copied object and ignores saved mappings", async function () {
    var harness = loadFusionRequest({
        requestMediaType: "json",
        payloadSource: "msgPayload",
        customPath: RESOURCE_ROOT + "/validateCorrectedQuantities",
        mappings: JSON.stringify([{
            scmField: "IgnoredMapping",
            sourceType: "static",
            value: "not-sent"
        }])
    });
    var payload = {
        OrganizationCode: "M001",
        lines: [{ Quantity: 1 }]
    };
    var result = await invokeNode(harness.node, { payload: payload });

    assert.equal(result.err, undefined);
    assert.equal(harness.getTokenCalls(), 1);
    assert.deepEqual(harness.axiosCalls[0].data, payload);
    assert.notEqual(harness.axiosCalls[0].data, payload);
    assert.notEqual(harness.axiosCalls[0].data.lines, payload.lines);
    assert.equal(harness.axiosCalls[0].data.IgnoredMapping, undefined);
});

test("Entire msg.payload mode uses the complete object as GET query parameters", async function () {
    var harness = loadFusionRequest({
        method: "GET",
        payloadSource: "msgPayload",
        customPath: RESOURCE_ROOT + "/meterReadings",
        mappings: JSON.stringify([{
            scmField: "IgnoredMapping",
            sourceType: "static",
            value: "not-sent"
        }])
    });
    var payload = {
        finder: "MetersByAssetMeterUserKey;MntAssetNumber=TEST-01,MntMeterCode=TEMP",
        limit: 1
    };
    var result = await invokeNode(harness.node, { payload: payload });

    assert.equal(result.err, undefined);
    assert.equal(harness.axiosCalls[0].data, undefined);
    assert.deepEqual(harness.axiosCalls[0].params, payload);
    assert.notEqual(harness.axiosCalls[0].params, payload);
    assert.equal(harness.axiosCalls[0].params.IgnoredMapping, undefined);
});

test("Entire msg.payload validation fails before authentication", async function () {
    var harness = loadFusionRequest({
        requestMediaType: "json",
        payloadSource: "msgPayload",
        customPath: RESOURCE_ROOT + "/validateCorrectedQuantities"
    });
    var result = await invokeNode(harness.node, { payload: ["not", "an", "object"] });

    assertRejectedBeforeAuthentication(
        harness,
        result,
        /msg\.payload must be a plain JSON object/
    );
    assert.equal(harness.node.statuses.at(-1).shape, "ring");
    assert.equal(harness.node.statuses.at(-1).text, "invalid payload");
});

test("Mapped fields rejects an empty write mapping table before authentication", async function () {
    var harness = loadFusionRequest({
        method: "POST",
        payloadSource: "mappings",
        mappings: "[]"
    });
    var result = await invokeNode(harness.node, {
        payload: { AssetNumber: "ASSET-IGNORED" }
    });

    assertRejectedBeforeAuthentication(
        harness,
        result,
        /Mapped fields requires at least one payload mapping/
    );
    assert.equal(harness.node.statuses.at(-1).shape, "ring");
    assert.equal(harness.node.statuses.at(-1).text, "invalid payload");
});

test("Mapped fields permits a parameterless GET without using msg.payload", async function () {
    var harness = loadFusionRequest({
        method: "GET",
        payloadSource: "mappings",
        mappings: "[]"
    });
    var result = await invokeNode(harness.node, {
        payload: { finder: "THIS-MUST-BE-IGNORED" }
    });

    assert.equal(result.err, undefined);
    assert.equal(harness.getTokenCalls(), 1);
    assert.equal(harness.axiosCalls.length, 1);
    assert.equal(harness.axiosCalls[0].method, "get");
    assert.deepEqual(harness.axiosCalls[0].params, {});
    assert.equal(harness.axiosCalls[0].data, undefined);
});

test("Mapped fields permits a bodyless DELETE without using msg.payload", async function () {
    var harness = loadFusionRequest({
        method: "DELETE",
        payloadSource: "mappings",
        customPath: RESOURCE_ROOT + "/meterReadings/123",
        mappings: "[]"
    });
    var result = await invokeNode(harness.node, {
        payload: { AssetNumber: "ASSET-IGNORED" }
    });

    assert.equal(result.err, undefined);
    assert.equal(harness.getTokenCalls(), 1);
    assert.equal(harness.axiosCalls.length, 1);
    assert.equal(harness.axiosCalls[0].method, "delete");
    assert.equal(harness.axiosCalls[0].params, undefined);
    assert.equal(harness.axiosCalls[0].data, undefined);
});

test("custom requests reject paths outside the exact configured SCM hierarchy before authentication", async function () {
    var rejectedUrls = [
        "https://" + FUSION_HOST + "/hcmRestApi/resources/" + API_VERSION + "/workers",
        "https://" + FUSION_HOST + ":8443/fscmRestApi/resources/" + API_VERSION + "/itemsV2",
        "https://user@" + FUSION_HOST + "/fscmRestApi/resources/" + API_VERSION + "/itemsV2",
        RESOURCE_ROOT + "/itemsV2#fragment",
        "https://" + FUSION_HOST + "/fscmRestApi/resources/24.01/itemsV2"
    ];

    for (var i = 0; i < rejectedUrls.length; i++) {
        var harness = loadFusionRequest({
            customPath: rejectedUrls[i],
            mappings: JSON.stringify([{
                scmField: "TestValue",
                sourceType: "static",
                value: "test"
            }])
        });
        var msg = {};
        var result = await invokeNode(harness.node, msg);

        assertRejectedBeforeAuthentication(
            harness,
            result,
            /configured Fusion REST origin and API version/
        );
        assert.deepEqual(msg.error, {
            message: result.err.message,
            code: null
        });
        assert.equal(harness.node.statuses.at(-1).shape, "ring");
    }
});

test("ADF Action requires POST but permits action payloads on resource URLs", async function () {
    var getHarness = loadFusionRequest({
        method: "GET",
        requestMediaType: "adfAction",
        customPath: RESOURCE_ROOT + "/receivingReturns/123"
    });
    var rejected = await invokeNode(getHarness.node, {});

    assertRejectedBeforeAuthentication(
        getHarness,
        rejected,
        /ADF Action requests must use POST/
    );

    var postHarness = loadFusionRequest({
        method: "POST",
        requestMediaType: "adfAction",
        customPath: RESOURCE_ROOT +
            "/maintenanceWorkOrders/123/action/generateRepairSummaryPromptParams",
        mappings: JSON.stringify([{
            scmField: "assetId",
            sourceType: "msg",
            value: "payload.assetId"
        }])
    });
    var accepted = await invokeNode(postHarness.node, {
        payload: { assetId: 456 }
    });

    assert.equal(accepted.err, undefined);
    assert.equal(postHarness.axiosCalls.length, 1);
    assert.equal(postHarness.axiosCalls[0].method, "post");
    assert.deepEqual(postHarness.axiosCalls[0].data, { assetId: 456 });
    assert.equal(
        postHarness.axiosCalls[0].headers["Content-Type"],
        "application/vnd.oracle.adf.action+json"
    );
});

test("ADF Batch posts validated parts to the exact API-version root", async function () {
    var harness = loadFusionRequest({
        method: "POST",
        requestMediaType: "adfBatch",
        customPath: RESOURCE_ROOT + "/",
        mappings: batchMappings()
    });
    var parts = [validBatchPart()];
    var result = await invokeNode(harness.node, { payload: { parts: parts } });

    assert.equal(result.err, undefined);
    assert.equal(harness.getTokenCalls(), 1);
    assert.equal(harness.axiosCalls.length, 1);
    assert.equal(
        harness.axiosCalls[0].headers["Content-Type"],
        "application/vnd.oracle.adf.batch+json"
    );
    assert.deepEqual(harness.axiosCalls[0].data, { parts: parts });
});

test("ADF Batch accepts nonempty IDs that match inherited object property names", async function () {
    var part = validBatchPart();
    part.id = "__proto__";
    var harness = loadFusionRequest({
        method: "POST",
        requestMediaType: "adfBatch",
        customPath: RESOURCE_ROOT + "/",
        mappings: batchMappings()
    });
    var result = await invokeNode(harness.node, { payload: { parts: [part] } });

    assert.equal(result.err, undefined);
    assert.equal(harness.axiosCalls.length, 1);
});

test("ADF Batch normalizes slashless standard paths without mutating the input", async function () {
    var slashless = validBatchPart();
    slashless.id = "slashless";
    slashless.path = "meterReadings?limit=1";
    slashless.operation = "get";
    delete slashless.payload;

    var rooted = validBatchPart();
    rooted.id = "rooted";
    rooted.path = "/meterReadings?limit=1";
    rooted.operation = "get";
    delete rooted.payload;

    var harness = loadFusionRequest({
        method: "POST",
        requestMediaType: "adfBatch",
        customPath: RESOURCE_ROOT + "/",
        mappings: batchMappings()
    });
    var parts = [slashless, rooted];
    var result = await invokeNode(harness.node, { payload: { parts: parts } });

    assert.equal(result.err, undefined);
    assert.equal(harness.axiosCalls.length, 1);
    assert.equal(
        harness.axiosCalls[0].data.parts[0].path,
        "/meterReadings?limit=1"
    );
    assert.equal(
        harness.axiosCalls[0].data.parts[1].path,
        "/meterReadings?limit=1"
    );
    assert.equal(slashless.path, "meterReadings?limit=1");
    assert.equal(rooted.path, "/meterReadings?limit=1");
});

test("ADF Batch permits parameterless invoke parts", async function () {
    var harness = loadFusionRequest({
        method: "POST",
        requestMediaType: "adfBatch",
        customPath: RESOURCE_ROOT + "/",
        mappings: batchMappings()
    });
    var part = {
        id: "invoke-action",
        path: "maintenanceWorkOrders/123/action/documentedNoPayloadAction",
        operation: "invoke"
    };
    var result = await invokeNode(harness.node, { payload: { parts: [part] } });

    assert.equal(result.err, undefined);
    assert.equal(harness.axiosCalls.length, 1);
    assert.equal(harness.axiosCalls[0].data.parts[0].path, part.path);
});

test("ADF Batch rejects non-root URLs and non-POST methods before authentication", async function () {
    var cases = [
        {
            method: "POST",
            customPath: RESOURCE_ROOT + "/meterReadings",
            expected: /exact configured SCM API-version root/
        },
        {
            method: "PATCH",
            customPath: RESOURCE_ROOT + "/",
            expected: /ADF Batch requests must use POST/
        }
    ];

    for (var i = 0; i < cases.length; i++) {
        var harness = loadFusionRequest({
            method: cases[i].method,
            requestMediaType: "adfBatch",
            customPath: cases[i].customPath,
            mappings: batchMappings()
        });
        var result = await invokeNode(harness.node, {
            payload: { parts: [validBatchPart()] }
        });

        assertRejectedBeforeAuthentication(harness, result, cases[i].expected);
    }
});

test("ADF Batch rejects unsafe or malformed parts before authentication", async function () {
    var duplicate = validBatchPart();
    duplicate.id = "duplicate";
    var secondDuplicate = validBatchPart();
    secondDuplicate.id = "duplicate";
    var invalidPayloads = [
        {
            payload: {},
            expected: /non-empty parts array/
        },
        {
            payload: {
                parts: [Object.assign(validBatchPart(), {
                    path: "https://other.example.test/meterReadings"
                })]
            },
            expected: /relative Fusion resource path/
        },
        {
            payload: {
                parts: [Object.assign(validBatchPart(), {
                    path: "//other.example.test/meterReadings"
                })]
            },
            expected: /relative Fusion resource path/
        },
        {
            payload: {
                parts: [Object.assign(validBatchPart(), {
                    path: "/meterReadings#fragment"
                })]
            },
            expected: /relative Fusion resource path/
        },
        {
            payload: {
                parts: [Object.assign(validBatchPart(), {
                    path: "meterReadings\\child"
                })]
            },
            expected: /relative Fusion resource path/
        },
        {
            payload: {
                parts: [Object.assign(validBatchPart(), {
                    path: "/%252e%252e/hcmRestApi/workers"
                })]
            },
            expected: /path traversal/
        },
        {
            payload: {
                parts: [Object.assign(validBatchPart(), {
                    path: "/" + encodeRepeatedly("%2e%2e", 12) + "/hcmRestApi/workers"
                })]
            },
            expected: /path traversal|encoding layers/
        },
        {
            payload: {
                parts: [Object.assign(validBatchPart(), {
                    operation: "execute"
                })]
            },
            expected: /unsupported operation/
        },
        {
            payload: {
                parts: [duplicate, secondDuplicate]
            },
            expected: /duplicate id/
        },
        {
            payload: {
                parts: [{
                    id: "missing-payload",
                    path: "/meterReadings",
                    operation: "create"
                }]
            },
            expected: /requires an object payload/
        },
        {
            payload: {
                parts: [{
                    id: "null-payload",
                    path: "/meterReadings",
                    operation: "create",
                    payload: null
                }]
            },
            expected: /requires an object payload/
        },
        {
            payload: {
                parts: [{
                    id: "invalid-invoke-payload",
                    path: "/maintenanceWorkOrders/123/action/example",
                    operation: "invoke",
                    payload: "not-an-object"
                }]
            },
            expected: /requires an object payload when payload is supplied/
        }
    ];

    for (var i = 0; i < invalidPayloads.length; i++) {
        var harness = loadFusionRequest({
            requestMediaType: "adfBatch",
            customPath: RESOURCE_ROOT + "/",
            mappings: batchMappings()
        });
        var result = await invokeNode(harness.node, invalidPayloads[i]);

        assertRejectedBeforeAuthentication(
            harness,
            result,
            invalidPayloads[i].expected
        );
    }
});

test("fusion request rejects unknown methods and media types before authentication", async function () {
    var cases = [
        {
            config: { method: "TRACE" },
            expected: /Unsupported HTTP method/
        },
        {
            config: {
                requestMediaType: "customHeaderValue",
                mappings: JSON.stringify([{
                    scmField: "TestValue",
                    sourceType: "static",
                    value: "test"
                }])
            },
            expected: /Unsupported request media type/
        }
    ];

    for (var i = 0; i < cases.length; i++) {
        var harness = loadFusionRequest(cases[i].config);
        var result = await invokeNode(harness.node, {});

        assertRejectedBeforeAuthentication(harness, result, cases[i].expected);
    }
});

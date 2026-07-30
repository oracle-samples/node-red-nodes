const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const editors = [
    {
        file: "db-nodes/nodes/db-connection.html",
        label: "Test Database Connection"
    },
    {
        file: "oci-nodes/nodes/oci-config.html",
        label: "Test OCI Credentials"
    },
    {
        file: "oci-nodes/nodes/ords-config.html",
        label: "Test OAuth Token"
    },
    {
        file: "oci-nodes/nodes/iot-config.html",
        label: "Test MQTT Connection"
    },
    {
        file: "fusion-scm-nodes/nodes/scm-server.html",
        label: "Test SCM Connection"
    }
];

function readEditor(file) {
    return fs.readFileSync(path.join(__dirname, file), "utf8");
}

function getTemplate(html) {
    const match = html.match(/<script type="text\/x-red" data-template-name="[^"]+">([\s\S]*?)<\/script>/);
    assert.ok(match, "editor template not found");
    return match[1];
}

test("config and server editors use one test action area after their fieldsets", function () {
    editors.forEach(function (editor) {
        const template = getTemplate(readEditor(editor.file));
        const actionMatches = template.match(/class="config-test-actions"/g) || [];
        const actionIndex = template.indexOf('class="config-test-actions"');

        assert.equal(actionMatches.length, 1, editor.file + " should contain one config-test-actions block");
        assert.ok(actionIndex > template.lastIndexOf("</fieldset>"), editor.file + " action block should follow all fieldsets");
        assert.match(template, new RegExp(">\\s*" + editor.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*<"));
    });
});

test("database test action follows the visible tab fields without reserved space", function () {
    const template = getTemplate(readEditor("db-nodes/nodes/db-connection.html"));
    const tabContainer = template.match(/<div id="node-config-tabs-content"[^>]*>/);

    assert.ok(tabContainer, "database tab content container not found");
    assert.doesNotMatch(
        tabContainer[0],
        /\bmin-height\s*:/,
        "database tab content should not reserve vertical space above the test action"
    );
});

test("database connection test reports a required TNS String before requesting the endpoint", function () {
    const html = readEditor("db-nodes/nodes/db-connection.html");
    const handlerStart = html.indexOf('$("#btn-test-connection").on("click"');
    const requestStart = html.indexOf("$.ajax", handlerStart);
    const handler = html.slice(handlerStart, requestStart);

    assert.ok(handlerStart >= 0);
    assert.match(handler, /validateTnsStringInput\(\$\("#node-config-input-tnsString"\)\.val\(\)\)/);
    assert.match(handler, /if \(!tnsValidation\.ok\)/);
    assert.match(html, /message: "TNS String is required\."/);
});

test("database Wallet Directory guidance is conditional", function () {
    const html = readEditor("db-nodes/nodes/db-connection.html");

    assert.match(
        html,
        /Enter the extracted wallet directory\. Do not enter a ZIP file or <code>tnsnames\.ora<\/code>\./
    );
});

test("database connection guidance distinguishes TNS input from Wallet Directory", function () {
    const html = readEditor("db-nodes/nodes/db-connection.html");

    assert.match(
        html,
        /Required\. Enter a TNS alias, or paste only the descriptor after <code>&lt;alias&gt; =<\/code>/
    );
    assert.match(html, /Wallet Directory<\/label>/);
    assert.match(html, /placeholder="\/path\/to\/extracted_wallet"/);
    assert.match(html, /Wallet Directory must be a directory, not a ZIP file or tnsnames\.ora\./);
});

test("database editor exposes backward-compatible Basic Session User guidance", function () {
    const html = readEditor("db-nodes/nodes/db-connection.html");
    const proxySection = html.match(
        /<div class="auth-section ([^"]*)">\s*<div class="form-row">\s*<label for="node-config-input-proxyUser"/
    );

    assert.ok(proxySection, "Session User editor section not found");
    assert.match(proxySection[1], /\bauth-basic\b/);
    assert.match(
        html,
        /Existing <code>USERNAME\[SESSION_USER\]<\/code> values remain supported when Session User is empty\./
    );
    assert.match(html, /Session User does not match the bracketed session user in Username\./);
});

test("connection-target checks use node-specific editor guidance", function () {
    const expectations = [
        ["oci-nodes/nodes/ords-config.html", "Configure a Token URL in the Authentication section."],
        ["oci-nodes/nodes/iot-config.html", "Configure a Device Host in the Connection section."],
        ["fusion-scm-nodes/nodes/scm-server.html", "Configure a Hostname in the Connection section."]
    ];

    expectations.forEach(function (expectation) {
        assert.match(readEditor(expectation[0]), new RegExp(expectation[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    });
});

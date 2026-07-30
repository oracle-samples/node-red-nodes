const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const oracleAuth = require("./oracle-auth.js");

test("node-oracledb 7 DB token Session Users are not blocked by Thick mode", function () {
    const manualConnectionJs = fs.readFileSync(
        path.join(__dirname, "..", "nodes", "db-connection.js"),
        "utf8"
    );
    const rootPackage = require(path.join(__dirname, "..", "..", "package.json"));
    const dbPackage = require(path.join(__dirname, "..", "package.json"));
    const sessionUserAssignments = manualConnectionJs.match(
        /if \(node\.proxyUser\) options\.user = `\[\$\{node\.proxyUser\}\]`;/g
    ) || [];

    assert.doesNotMatch(manualConnectionJs, /Proxy User is not supported with DB Token authentication/);
    assert.equal(sessionUserAssignments.length, 5);
    assert.match(rootPackage.dependencies.oracledb, /^\^7\./);
    assert.match(dbPackage.dependencies.oracledb, /^\^7\./);
});

test("Basic auth composes and preserves Oracle proxy username notation", function () {
    assert.equal(
        oracleAuth.buildBasicUsername("APP_PROXY", "SESSION_USER"),
        "APP_PROXY[SESSION_USER]"
    );
    assert.equal(
        oracleAuth.buildBasicUsername("APP_PROXY[SESSION_USER]", ""),
        "APP_PROXY[SESSION_USER]"
    );
    assert.equal(
        oracleAuth.buildBasicUsername("APP_PROXY[SESSION_USER]", "session_user"),
        "APP_PROXY[SESSION_USER]"
    );
    assert.throws(
        function () {
            oracleAuth.buildBasicUsername("APP_PROXY[SESSION_USER]", "OTHER_USER");
        },
        /Session User does not match/
    );
});

test("Thick wallet aliases resolve from the configured wallet directory", function () {
    const walletDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "node-red-wallet-"));
    try {
        fs.writeFileSync(
            path.join(walletDirectory, "tnsnames.ora"),
            "TEST_DB = (description=(address=(protocol=tcps)(host=db.example.com)(port=1522))(connect_data=(service_name=testdb)))\n"
        );
        const connectString = oracleAuth.prepareConnectString(
            "TEST_DB",
            walletDirectory,
            "thick"
        );

        assert.match(connectString, /\(description=/i);
        assert.match(connectString, /\(my_wallet_directory=/i);
        assert.match(connectString, new RegExp(walletDirectory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    } finally {
        fs.rmSync(walletDirectory, { recursive: true, force: true });
    }
});

test("editor identifies the proxy target as the Session User", function () {
    const editorHtml = fs.readFileSync(
        path.join(__dirname, "..", "nodes", "db-connection.html"),
        "utf8"
    );

    assert.match(
        editorHtml,
        /for="node-config-input-proxyUser"[^>]*>[^<]*<i[^>]*><\/i> Session User<\/label>/
    );
    assert.match(editorHtml, /appears as <code>SESSION_USER<\/code>/);
    assert.match(editorHtml, /appears as <code>PROXY_USER<\/code>/);
});

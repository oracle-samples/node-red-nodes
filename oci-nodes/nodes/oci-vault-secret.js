/*
 Copyright (c) 2026 Oracle and/or its affiliates.
 Licensed under the Universal Permissive License (UPL), Version 1.0.
*/

module.exports = function (RED) {
    var secrets = require("oci-secrets");
    var common = require("oci-common");
    var safe = require("../lib/oci-sensitive.js");
    function OciVaultSecretNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        var auth = RED.nodes.getNode(config.ociConfig);
        var lifecycle = safe.lifecycle(node, config, "Secret retrieval");
        node.on("input", function (msg, send, done) {
            var request;
            var format;
            try {
                if (!auth) throw new Error("OCI Config is required");
                request = Object.assign({ secretId: safe.required(safe.option(config.secretId, msg.secretId), "Secret OCID") }, safe.selector(config));
                format = safe.option(config.outputFormat, "text");
                if (["text", "json", "buffer"].indexOf(format) === -1) throw new Error("Invalid secret output format");
            } catch (err) { safe.fail(node, msg, done, "Secret retrieval", true, err); return; }
            lifecycle.submit(msg, send, done, async function (operation) {
                var provider = await auth.getAuthProvider();
                operation.check();
                var client = operation.own(new secrets.SecretsClient({ authenticationDetailsProvider: provider },
                    safe.clientConfiguration(common, operation.signal)));
                var region = auth.getRegion();
                if (region) client.regionId = region;
                operation.check();
                var response = await client.getSecretBundle(request);
                operation.check();
                var bundle = response.secretBundle;
                var content = bundle && bundle.secretBundleContent;
                if (!content || content.contentType !== "BASE64" || typeof content.content !== "string" ||
                    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content.content)) {
                    throw new Error("Invalid secret content");
                }
                var value = Buffer.from(content.content, "base64");
                if (format !== "buffer") value = value.toString("utf8");
                if (format === "json") value = JSON.parse(value);
                return { payload: value, secretVersionNumber: bundle.versionNumber,
                    opcRequestId: response.opcRequestId, statusCode: response.__httpStatusCode || 200 };
            });
        });
    }
    RED.nodes.registerType("oci-vault-secret", OciVaultSecretNode);
};

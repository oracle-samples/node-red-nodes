/*
 Copyright (c) 2026 Oracle and/or its affiliates.
 Licensed under the Universal Permissive License (UPL), Version 1.0.
*/

module.exports = function (RED) {
    var certificates = require("oci-certificates");
    var common = require("oci-common");
    var safe = require("../lib/oci-sensitive.js");
    function OciCertificateNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        var auth = RED.nodes.getNode(config.ociConfig);
        var lifecycle = safe.lifecycle(node, config, "Certificate retrieval");
        node.on("input", function (msg, send, done) {
            var request, method, result;
            try {
                if (!auth) throw new Error("OCI Config is required");
                var id = safe.required(safe.option(config.resourceId, msg.certificateResourceId), "Certificate resource OCID");
                var type = safe.option(config.resourceType, "certificate");
                if (config.includePrivateKey !== undefined && typeof config.includePrivateKey !== "boolean") throw new Error("Private key selection must be a boolean");
                switch (type) {
                    case "certificate":
                        request = Object.assign({ certificateId: id, certificateBundleType: config.includePrivateKey === true
                            ? "CERTIFICATE_CONTENT_WITH_PRIVATE_KEY" : "CERTIFICATE_CONTENT_PUBLIC_ONLY" }, safe.selector(config));
                        method = "getCertificateBundle"; result = "certificateBundle"; break;
                    case "caBundle":
                        if (config.includePrivateKey) throw new Error("CA bundles do not expose private keys");
                        request = { caBundleId: id }; method = "getCaBundle"; result = "caBundle"; break;
                    case "caAuthority":
                        if (config.includePrivateKey) throw new Error("CA authority bundles do not expose private keys");
                        request = Object.assign({ certificateAuthorityId: id }, safe.selector(config));
                        method = "getCertificateAuthorityBundle"; result = "certificateAuthorityBundle"; break;
                    default: throw new Error("Invalid certificate resource type");
                }
            } catch (err) { safe.fail(node, msg, done, "Certificate retrieval", true, err); return; }
            lifecycle.submit(msg, send, done, async function (operation) {
                var provider = await auth.getAuthProvider();
                operation.check();
                var client = operation.own(new certificates.CertificatesClient({ authenticationDetailsProvider: provider },
                    safe.clientConfiguration(common, operation.signal)));
                var region = auth.getRegion();
                if (region) client.regionId = region;
                operation.check();
                var response = await client[method](request);
                operation.check();
                var bundle = response[result];
                if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) throw new Error("Missing certificate bundle");
                safe.required(bundle[type === "caBundle" ? "caBundlePem" : "certificatePem"], "Certificate content");
                if (config.includePrivateKey !== true && bundle.privateKeyPem !== undefined) throw new Error("Unexpected private key");
                if (config.includePrivateKey === true) safe.required(bundle.privateKeyPem, "Private key");
                return { payload: bundle, opcRequestId: response.opcRequestId,
                    statusCode: response.__httpStatusCode || 200 };
            });
        });
    }
    RED.nodes.registerType("oci-certificate", OciCertificateNode);
};

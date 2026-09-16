/* Copyright (c) 2026 Oracle and/or its affiliates. Licensed under the UPL, Version 1.0. */

module.exports = function (RED) {
    var streaming = require("oci-streaming");
    var streamingSupport = require("../lib/oci-streaming.js");

    function OciStreamingConfigNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.ociConfig = RED.nodes.getNode(config.ociConfig);
        node.streamOcid = config.streamOcid || "";
        node.messagesEndpoint = config.messagesEndpoint || "";
        var client = null;
        var clientPromise = null;

        node.getStreamOcid = function () {
            if (!node.streamOcid.trim()) {
                throw streamingSupport.validationError("Stream OCID is required");
            }
            return node.streamOcid.trim();
        };

        node.getClient = async function () {
            if (!node.ociConfig) {
                throw streamingSupport.validationError("OCI Config is required");
            }
            if (client) return client;
            if (clientPromise) return clientPromise;

            clientPromise = (async function () {
                var endpoint = streamingSupport.validateEndpoint(node.messagesEndpoint);
                node.getStreamOcid();
                var provider = await node.ociConfig.getAuthProvider();
                var createdClient = new streaming.StreamClient({
                    authenticationDetailsProvider: provider
                });
                createdClient.endpoint = endpoint;
                client = createdClient;
                return client;
            })();
            try {
                return await clientPromise;
            } finally {
                clientPromise = null;
            }
        };

        if (!node.ociConfig) {
            node.status({ fill: "red", shape: "ring", text: "no OCI config" });
            node.error("No OCI Config configured");
            return;
        }

        node.on("close", async function (removed, done) {
            try {
                if (clientPromise) {
                    try {
                        await clientPromise;
                    } catch (err) {
                        // A failed creation attempt has no client resources to release.
                    }
                }
                if (client && typeof client.shutdownCircuitBreaker === "function") {
                    client.shutdownCircuitBreaker();
                }
                client = null;
                done();
            } catch (err) {
                done(err);
            }
        });
    }

    RED.nodes.registerType("oci-streaming-config", OciStreamingConfigNode);
};

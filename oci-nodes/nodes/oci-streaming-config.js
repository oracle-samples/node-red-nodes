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
        var clientManager = require("../lib/oci-client.js")(node);

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
            return clientManager.get("default", async function () {
                streamingSupport.validateEndpoint(node.messagesEndpoint);
                node.getStreamOcid();
                var provider = await node.ociConfig.getAuthProvider();
                return new streaming.StreamClient({ authenticationDetailsProvider: provider });
            }, function (client) {
                client.endpoint = streamingSupport.validateEndpoint(node.messagesEndpoint);
            });
        };

        if (!node.ociConfig) {
            node.status({ fill: "red", shape: "ring", text: "no OCI config" });
            node.error("No OCI Config configured");
            return;
        }


    }

    RED.nodes.registerType("oci-streaming-config", OciStreamingConfigNode);
};

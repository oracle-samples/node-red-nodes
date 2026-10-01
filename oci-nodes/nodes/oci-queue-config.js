/* Copyright (c) 2026 Oracle and/or its affiliates. Licensed under the UPL, Version 1.0. */

module.exports = function (RED) {
    var queue = require("oci-queue");
    var common = require("oci-common");
    var queueSupport = require("../lib/oci-queue.js");

    function OciQueueConfigNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.ociConfig = RED.nodes.getNode(config.ociConfig);
        node.queueOcid = config.queueOcid || "";
        node.messagesEndpoint = config.messagesEndpoint || "";
        if (!node.ociConfig) {
            node.status({ fill: "red", shape: "ring", text: "no OCI config" });
            node.error("No OCI Config configured");
            return;
        }

        var clientManager = require("../lib/oci-client.js")(node);

        node.getQueueOcid = function () {
            if (!node.queueOcid.trim()) {
                throw queueSupport.validationError("Queue OCID is required");
            }
            return node.queueOcid.trim();
        };

        async function createClient(signal) {
            clientManager.assertOpen();
            queueSupport.validateEndpoint(node.messagesEndpoint);
            node.getQueueOcid();
            if (signal && signal.aborted) throw new Error("Queue receive client creation cancelled");
            var provider = await node.ociConfig.getAuthProvider();
            if (signal && signal.aborted) throw new Error("Queue receive client creation cancelled");
            clientManager.assertOpen();
            var createdClient = new queue.QueueClient(
                { authenticationDetailsProvider: provider },
                // Queue In owns retry backoff; use direct fetch for abortable long polls.
                signal ? {
                    httpOptions: { signal: signal },
                    circuitBreaker: new common.CircuitBreaker({ disableClientCircuitBreaker: true })
                } : undefined
            );
            return createdClient;
        }

        node.getClient = async function (signal) {
            // Receivers own cancellation; publishers and acknowledgements share the cached client.
            function configure(client) {
                client.endpoint = queueSupport.validateEndpoint(node.messagesEndpoint);
            }
            if (signal) {
                // The receiver owns this client; its circuit breaker is disabled.
                var receiver = await createClient(signal);
                configure(receiver);
                return receiver;
            }
            return clientManager.get("default", createClient, configure);
        };

    }

    RED.nodes.registerType("oci-queue-config", OciQueueConfigNode);

    RED.httpAdmin.post(
        "/oci-queue-config/:id/test",
        RED.auth.needsPermission("oci-queue-config.write"),
        async function (req, res) {
            var node = RED.nodes.getNode(req.params.id);
            if (!node) {
                return res.status(404).json({ success: false, message: "Node not found. Deploy the flow first, then test." });
            }
            try {
                var client = await node.getClient();
                await client.getStats({ queueId: node.getQueueOcid() });
                res.json({ success: true, message: "Connected to OCI Queue" });
            } catch (err) {
                res.json({ success: false, message: "OCI Queue connection failed" });
            }
        }
    );
};

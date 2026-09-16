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

        var client = null;
        var clientPromise = null;

        node.getQueueOcid = function () {
            if (!node.queueOcid.trim()) {
                throw queueSupport.validationError("Queue OCID is required");
            }
            return node.queueOcid.trim();
        };

        async function createClient(signal) {
            var endpoint = queueSupport.validateEndpoint(node.messagesEndpoint);
            node.getQueueOcid();
            if (signal && signal.aborted) throw new Error("Queue receive client creation cancelled");
            var provider = await node.ociConfig.getAuthProvider();
            if (signal && signal.aborted) throw new Error("Queue receive client creation cancelled");
            var createdClient = new queue.QueueClient(
                { authenticationDetailsProvider: provider },
                // Queue In owns retry backoff; use direct fetch for abortable long polls.
                signal ? {
                    httpOptions: { signal: signal },
                    circuitBreaker: new common.CircuitBreaker({ disableClientCircuitBreaker: true })
                } : undefined
            );
            createdClient.endpoint = endpoint;
            return createdClient;
        }

        node.getClient = async function (signal) {
            // Receivers own cancellation; publishers and acknowledgements share the cached client.
            if (signal) return createClient(signal);
            if (client) return client;
            if (clientPromise) return clientPromise;
            clientPromise = (async function () {
                client = await createClient();
                return client;
            })();
            try {
                return await clientPromise;
            } finally {
                clientPromise = null;
            }
        };

        node.on("close", async function (removed, done) {
            try {
                if (clientPromise) {
                    try { await clientPromise; } catch (err) { /* Creation failure needs no close. */ }
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

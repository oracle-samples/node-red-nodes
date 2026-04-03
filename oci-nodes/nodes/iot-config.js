/*
 Copyright (c) 2025 Oracle and/or its affiliates.
 The Universal Permissive License (UPL), Version 1.0

 Subject to the condition set forth below, permission is hereby granted to any
 person obtaining a copy of this software, associated documentation and/or data
 (collectively the "Software"), free of charge and under any and all copyright
 rights in the Software, and any and all patent rights owned or freely
 licensable by each licensor hereunder covering either (i) the unmodified
 Software as contributed to or provided by such licensor, or (ii) the Larger
 Works (as defined below), to deal in both

 (a) the Software, and
 (b) any piece of software and/or hardware listed in the
     lrgrwrks.txt file if one is included with the Software (each a "Larger
     Work" to which the Software is contributed by such licensors),

 without restriction, including without limitation the rights to copy, create
 derivative works of, display, perform, and distribute the Software and make,
 use, sell, offer for sale, import, export, have made, and have sold the
 Software and the Larger Work(s), and to sublicense the foregoing rights on
 either these or other terms.

 This license is subject to the following condition: The above copyright notice
 and either this complete permission notice or at a minimum a reference to the
 UPL must be included in all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 SOFTWARE.
 */

module.exports = function (RED) {
    const mqtt = require("mqtt");
    const fs = require("fs");
    const path = require("path");

    /**
     * Match an MQTT topic against a subscription pattern.
     * Supports # (multi-level wildcard, must be last segment) and + (single-level wildcard).
     */
    function mqttTopicMatches(pattern, topic) {
        if (pattern === "#") return true;
        var patternParts = pattern.split("/");
        var topicParts = topic.split("/");
        for (var i = 0; i < patternParts.length; i++) {
            if (patternParts[i] === "#") return true;
            if (i >= topicParts.length) return false;
            if (patternParts[i] !== "+" && patternParts[i] !== topicParts[i]) return false;
        }
        return patternParts.length === topicParts.length;
    }

    function IotDeviceNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Connection settings.
        node.deviceHost = config.deviceHost || "";
        node.clientId = config.clientId || "";

        // Auth settings.
        node.authType = config.authType || "basic";
        node.username = (this.credentials && this.credentials.username) || "";
        node.password = (this.credentials && this.credentials.password) || "";
        node.caCertPath = config.caCertPath || "";
        node.clientCertPath = config.clientCertPath || "";
        node.clientKeyPath = config.clientKeyPath || "";

        // Proxy settings.
        node.useProxy = config.useProxy || false;
        node.proxyUrl = config.proxyUrl || "";

        // Runtime state.
        let client = null;
        let topicSubscriptions = {};   // topic → [{qos, callback}, ...]
        let connectionListeners = [];
        let reconnectCount = 0;

        /**
         * Build MQTT connection options based on auth type.
         */
        function buildConnectOptions() {
            const opts = {
                clientId: node.clientId,
                clean: false,           // Persistent session — required for commands
                protocol: "mqtts",
                port: 8883,
                keepalive: 60,
                reconnectPeriod: 5000,   // Auto-reconnect every 5s
                connectTimeout: 30000
            };

            // Optional CA certificate override.
            if (node.caCertPath && fs.existsSync(node.caCertPath)) {
                opts.ca = [fs.readFileSync(node.caCertPath)];
            }

            if (node.authType === "basic") {
                opts.username = node.username;
                opts.password = node.password;
            } else if (node.authType === "cert") {
                if (node.clientCertPath && fs.existsSync(node.clientCertPath)) {
                    opts.cert = fs.readFileSync(node.clientCertPath);
                }
                if (node.clientKeyPath && fs.existsSync(node.clientKeyPath)) {
                    opts.key = fs.readFileSync(node.clientKeyPath);
                }
            }

            return opts;
        }

        /**
         * Connect to the OCI IoT Platform MQTT broker.
         */
        function connect() {
            if (client) return;
            if (!node.deviceHost) {
                node.error("No device host configured");
                return;
            }

            const url = "mqtts://" + node.deviceHost + ":8883";
            const opts = buildConnectOptions();

            try {
                client = mqtt.connect(url, opts);
            } catch (err) {
                node.error("MQTT connect error: " + err.message);
                return;
            }

            client.on("connect", function () {
                reconnectCount = 0;
                node.log("Connected to " + node.deviceHost);

                // Re-subscribe all registered topic listeners.
                Object.keys(topicSubscriptions).forEach(function (t) {
                    var maxQos = topicSubscriptions[t].reduce(function (m, s) { return Math.max(m, s.qos || 1); }, 0);
                    client.subscribe(t, { qos: maxQos }, function (err) {
                        if (err) node.error("Subscribe failed for " + t + ": " + err.message);
                        else node.log("Subscribed to " + t);
                    });
                });

                connectionListeners.forEach(function (cb) { cb("connected"); });
            });

            client.on("message", function (topic, message) {
                var payload;
                try {
                    payload = JSON.parse(message.toString());
                } catch (e) {
                    payload = message.toString();
                }

                Object.keys(topicSubscriptions).forEach(function (pattern) {
                    if (mqttTopicMatches(pattern, topic)) {
                        topicSubscriptions[pattern].forEach(function (sub) {
                            sub.callback(topic, payload);
                        });
                    }
                });
            });

            client.on("reconnect", function () {
                reconnectCount++;
                node.log("Reconnecting... (attempt " + reconnectCount + ")");
                connectionListeners.forEach(function (cb) { cb("reconnecting"); });
            });

            client.on("offline", function () {
                connectionListeners.forEach(function (cb) { cb("offline"); });
            });

            client.on("error", function (err) {
                node.error("MQTT error: " + err.message);
                connectionListeners.forEach(function (cb) { cb("error", err); });
            });

            client.on("close", function () {
                connectionListeners.forEach(function (cb) { cb("disconnected"); });
            });
        }

        /**
         * Publish a message to a topic.
         * @param {string} topic - MQTT topic
         * @param {string|Buffer} payload - Message payload
         * @param {object} [opts] - Publish options (qos, retain)
         * @param {function} [callback] - Called on publish complete
         */
        node.publish = function (topic, payload, opts, callback) {
            if (!client || !client.connected) {
                var err = new Error("Not connected to MQTT broker");
                if (callback) return callback(err);
                return;
            }
            var pubOpts = Object.assign({ qos: 1 }, opts || {});
            client.publish(topic, payload, pubOpts, callback);
        };

        /**
         * Subscribe to an MQTT topic. The callback is called for each matching message.
         * On reconnect, all registered subscriptions are restored automatically.
         * @param {string} topic - MQTT topic pattern (supports # and + wildcards)
         * @param {number} qos - QoS level (0, 1, or 2)
         * @param {function} callback - function(receivedTopic, payload)
         */
        node.subscribe = function (topic, qos, callback) {
            if (!topicSubscriptions[topic]) topicSubscriptions[topic] = [];
            topicSubscriptions[topic].push({ qos: qos || 1, callback: callback });
            if (client && client.connected) {
                client.subscribe(topic, { qos: qos || 1 }, function (err) {
                    if (err) node.error("Subscribe failed for " + topic + ": " + err.message);
                });
            }
        };

        /**
         * Unsubscribe a previously registered callback from a topic.
         * The MQTT subscription is dropped when no more callbacks remain for that topic.
         * @param {string} topic - The topic pattern passed to subscribe()
         * @param {function} callback - The exact callback reference passed to subscribe()
         */
        node.unsubscribe = function (topic, callback) {
            if (!topicSubscriptions[topic]) return;
            topicSubscriptions[topic] = topicSubscriptions[topic].filter(function (s) {
                return s.callback !== callback;
            });
            if (topicSubscriptions[topic].length === 0) {
                delete topicSubscriptions[topic];
                if (client && client.connected) client.unsubscribe(topic);
            }
        };

        /**
         * Register a callback for connection state changes.
         * @param {function} callback - function(state, err)
         */
        node.onConnection = function (callback) {
            connectionListeners.push(callback);
        };

        /**
         * Unregister a connection callback.
         */
        node.offConnection = function (callback) {
            connectionListeners = connectionListeners.filter(function (cb) { return cb !== callback; });
        };

        /**
         * Returns whether the client is currently connected.
         */
        node.isConnected = function () {
            return client && client.connected;
        };

        // Connect on node creation.
        connect();

        // Cleanup on close.
        node.on("close", function (done) {
            topicSubscriptions = {};
            connectionListeners = [];
            if (client) {
                client.end(true, function () {
                    client = null;
                    done();
                });
            } else {
                done();
            }
        });
    }

    RED.nodes.registerType("iot-config", IotDeviceNode, {
        credentials: {
            username: { type: "text" },
            password: { type: "password" }
        }
    });

    // Test Connection HTTP endpoint.
    RED.httpAdmin.post("/iot-config/:id/test", RED.auth.needsPermission("iot-config.write"), function (req, res) {
        var configNode = RED.nodes.getNode(req.params.id);
        if (!configNode) {
            return res.status(404).json({ success: false, message: "Node not found. Deploy the flow first, then test." });
        }

        if (!configNode.deviceHost) {
            return res.json({ success: false, message: "No device host configured." });
        }

        // Test with a temporary MQTT connection.
        var url = "mqtts://" + configNode.deviceHost + ":8883";
        var opts = {
            clientId: configNode.clientId + "_test_" + Date.now(),
            clean: true,
            protocol: "mqtts",
            port: 8883,
            connectTimeout: 15000,
            reconnectPeriod: 0
        };

        if (configNode.caCertPath && fs.existsSync(configNode.caCertPath)) {
            opts.ca = [fs.readFileSync(configNode.caCertPath)];
        }

        if (configNode.authType === "basic") {
            opts.username = configNode.username;
            opts.password = configNode.password;
        } else if (configNode.authType === "cert") {
            if (configNode.clientCertPath && fs.existsSync(configNode.clientCertPath)) {
                opts.cert = fs.readFileSync(configNode.clientCertPath);
            }
            if (configNode.clientKeyPath && fs.existsSync(configNode.clientKeyPath)) {
                opts.key = fs.readFileSync(configNode.clientKeyPath);
            }
        }

        var testTimeout = setTimeout(function () {
            testClient.end(true);
            res.json({ success: false, message: "Connection timed out after 15 seconds." });
        }, 15000);

        var testClient;
        try {
            testClient = mqtt.connect(url, opts);
        } catch (err) {
            clearTimeout(testTimeout);
            return res.json({ success: false, message: err.message });
        }

        testClient.on("connect", function () {
            clearTimeout(testTimeout);
            testClient.end(true);
            res.json({
                success: true,
                message: "Connected to " + configNode.deviceHost + " as " + configNode.clientId
            });
        });

        testClient.on("error", function (err) {
            clearTimeout(testTimeout);
            testClient.end(true);
            res.json({ success: false, message: err.message });
        });
    });
};

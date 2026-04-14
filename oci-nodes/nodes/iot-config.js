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

    function toBoundedInt(value, fallback, min, max) {
        var n = parseInt(value, 10);
        if (Number.isNaN(n)) return fallback;
        if (n < min) return min;
        if (n > max) return max;
        return n;
    }

    /**
     * Match an MQTT topic against a subscription pattern.
     * Supports # (multi-level wildcard, must be last segment) and + (single-level wildcard).
     */
    function isValidSubscriptionPattern(pattern) {
        if (typeof pattern !== "string" || !pattern.trim()) return false;
        if (pattern === "#") return true;
        var patternParts = pattern.split("/");
        var hashCount = 0;
        for (var i = 0; i < patternParts.length; i++) {
            var seg = patternParts[i];
            if (seg.indexOf("#") !== -1) {
                if (seg !== "#" || i !== patternParts.length - 1) return false;
                hashCount++;
                if (hashCount > 1) return false;
            }
            if (seg.indexOf("+") !== -1 && seg !== "+") return false;
        }
        return true;
    }

    function mqttTopicMatches(pattern, topic) {
        if (!isValidSubscriptionPattern(pattern)) return false;
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
        node.deviceHost = (config.deviceHost || "").trim().replace(/^\w+:\/\//, "").replace(/\/+$/, "");
        node.clientId = (config.clientId || "").trim();

        // Auth settings.
        node.authType = config.authType || "basic";
        node.username = (this.credentials && this.credentials.username) || "";
        node.password = (this.credentials && this.credentials.password) || "";
        node.caCertPath = config.caCertPath || "";
        node.clientCertPath = config.clientCertPath || "";
        node.clientKeyPath = config.clientKeyPath || "";
        node.clean = (config.clean === true || config.clean === "true");
        node.keepalive = toBoundedInt(config.keepalive, 60, 15, 300);
        node.reconnectPeriod = toBoundedInt(config.reconnectPeriod, 5000, 1000, 60000);
        node.connectTimeout = toBoundedInt(config.connectTimeout, 30000, 5000, 120000);

        // Runtime state.
        let client = null;
        let topicSubscriptions = {};   // topic → [{qos, callback}, ...]
        let connectionListeners = [];
        let reconnectCount = 0;
        const CLOSE_SAFETY_TIMEOUT_MS = 5000;

        /**
         * Build MQTT connection options based on auth type.
         */
        function buildConnectOptions() {
            const opts = {
                clientId: node.clientId,
                clean: node.clean,
                protocol: "mqtts",
                port: 8883,
                keepalive: node.keepalive,
                reconnectPeriod: node.reconnectPeriod,
                connectTimeout: node.connectTimeout
            };

            // Optional CA certificate override.
            if (node.caCertPath && fs.existsSync(node.caCertPath)) {
                try {
                    opts.ca = [fs.readFileSync(node.caCertPath)];
                } catch (e) {
                    node.error("Failed to read CA cert at " + node.caCertPath + ": " + e.message);
                }
            }

            if (node.authType === "basic") {
                opts.username = node.username;
                opts.password = node.password;
            } else if (node.authType === "cert") {
                if (node.clientCertPath && fs.existsSync(node.clientCertPath)) {
                    try {
                        opts.cert = fs.readFileSync(node.clientCertPath);
                    } catch (e) {
                        node.error("Failed to read client cert at " + node.clientCertPath + ": " + e.message);
                    }
                }
                if (node.clientKeyPath && fs.existsSync(node.clientKeyPath)) {
                    try {
                        opts.key = fs.readFileSync(node.clientKeyPath);
                    } catch (e) {
                        node.error("Failed to read client key at " + node.clientKeyPath + ": " + e.message);
                    }
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

            const opts = buildConnectOptions();
            if (!opts.clientId && opts.clean === false) {
                node.warn("clientId is empty while clean=false; switching clean=true for this connection");
                opts.clean = true;
            }
            const url = "mqtts://" + node.deviceHost + ":8883";

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
                    var maxQos = topicSubscriptions[t].reduce(function (m, s) {
                        var q = (s.qos === 0 || s.qos === 1 || s.qos === 2) ? s.qos : 1;
                        return Math.max(m, q);
                    }, 0);
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
                            try {
                                sub.callback(topic, payload);
                            } catch (err) {
                                node.error("Subscriber callback error for topic " + topic + ": " + err.message);
                            }
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
                node.error("Publish failed: not connected to MQTT broker");
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
            var normalizedTopic = String(topic || "").trim();
            if (!normalizedTopic) {
                node.error("Subscribe failed: topic is required");
                return;
            }
            if (!isValidSubscriptionPattern(normalizedTopic)) {
                node.error("Subscribe failed: invalid MQTT topic pattern '" + normalizedTopic + "'");
                return;
            }
            if (typeof callback !== "function") {
                node.error("Subscribe failed: callback must be a function");
                return;
            }
            var normalizedQos = (qos === 0 || qos === 1 || qos === 2) ? qos : 1;
            if (!topicSubscriptions[normalizedTopic]) topicSubscriptions[normalizedTopic] = [];
            topicSubscriptions[normalizedTopic].push({ qos: normalizedQos, callback: callback });
            if (client && client.connected) {
                client.subscribe(normalizedTopic, { qos: normalizedQos }, function (err) {
                    if (err) node.error("Subscribe failed for " + normalizedTopic + ": " + err.message);
                });
            }
        };

        /**
         * Unsubscribe a previously registered callback from a topic.
         * The MQTT subscription is dropped when no more callbacks remain for that topic.
         * @param {string} topic - The topic pattern passed to subscribe()
         * @param {function} callback - The exact callback reference passed to subscribe()
         */
        node.unsubscribe = function (topic, callback, done) {
            var normalizedTopic = String(topic || "").trim();
            function finish(err) {
                if (typeof done === "function") {
                    try { done(err); } catch (e) { node.error("Unsubscribe completion handler failed: " + e.message); }
                }
            }
            if (!topicSubscriptions[normalizedTopic]) {
                finish(null);
                return;
            }
            topicSubscriptions[normalizedTopic] = topicSubscriptions[normalizedTopic].filter(function (s) {
                return s.callback !== callback;
            });
            if (topicSubscriptions[normalizedTopic].length === 0) {
                delete topicSubscriptions[normalizedTopic];
                if (client && client.connected) {
                    client.unsubscribe(normalizedTopic, function (err) {
                        if (err) node.error("Unsubscribe failed for " + normalizedTopic + ": " + err.message);
                        finish(err || null);
                    });
                } else {
                    finish(null);
                }
            } else {
                finish(null);
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
            var finished = false;
            var doneTimer = setTimeout(function () {
                if (finished) return;
                finished = true;
                done();
            }, CLOSE_SAFETY_TIMEOUT_MS);

            function finish() {
                if (finished) return;
                finished = true;
                clearTimeout(doneTimer);
                done();
            }

            if (client) {
                client.end(true, function () {
                    client = null;
                    finish();
                });
            } else {
                finish();
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
        var opts = {
            clientId: configNode.clientId + "_test_" + Date.now(),
            clean: true,
            protocol: "mqtts",
            port: 8883,
            keepalive: configNode.keepalive || 60,
            connectTimeout: configNode.connectTimeout || 30000,
            reconnectPeriod: 0
        };
        var url = "mqtts://" + configNode.deviceHost + ":8883";

        if (configNode.caCertPath && fs.existsSync(configNode.caCertPath)) {
            try {
                opts.ca = [fs.readFileSync(configNode.caCertPath)];
            } catch (e) {
                return res.json({ success: false, message: "Failed to read CA cert at " + configNode.caCertPath + ": " + e.message });
            }
        }

        if (configNode.authType === "basic") {
            opts.username = configNode.username;
            opts.password = configNode.password;
        } else if (configNode.authType === "cert") {
            if (configNode.clientCertPath && fs.existsSync(configNode.clientCertPath)) {
                try {
                    opts.cert = fs.readFileSync(configNode.clientCertPath);
                } catch (e) {
                    return res.json({ success: false, message: "Failed to read client cert at " + configNode.clientCertPath + ": " + e.message });
                }
            }
            if (configNode.clientKeyPath && fs.existsSync(configNode.clientKeyPath)) {
                try {
                    opts.key = fs.readFileSync(configNode.clientKeyPath);
                } catch (e) {
                    return res.json({ success: false, message: "Failed to read client key at " + configNode.clientKeyPath + ": " + e.message });
                }
            }
        }

        var responded = false;
        var testClient;
        var testTimeoutMs = Math.max((opts.connectTimeout || 30000) + 1000, 5000);
        var testTimeout = setTimeout(function () {
            safeRespond({ success: false, message: "Connection timed out after " + Math.round(testTimeoutMs / 1000) + " seconds." });
        }, testTimeoutMs);

        function cleanup() {
            clearTimeout(testTimeout);
            if (testClient) {
                testClient.removeListener("connect", onConnect);
                testClient.removeListener("error", onError);
                try { testClient.end(true); } catch (e) {}
            }
        }

        function safeRespond(payload) {
            if (responded) return;
            responded = true;
            cleanup();
            res.json(payload);
        }

        try {
            testClient = mqtt.connect(url, opts);
        } catch (err) {
            return safeRespond({ success: false, message: err.message });
        }

        function onConnect() {
            safeRespond({
                success: true,
                message: "Connected to " + configNode.deviceHost + " as " + configNode.clientId
            });
        }

        function onError(err) {
            safeRespond({ success: false, message: err.message });
        }

        testClient.on("connect", onConnect);
        testClient.on("error", onError);
    });
};

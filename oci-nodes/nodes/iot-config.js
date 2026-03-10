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

    function IotDeviceNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Connection settings
        node.deviceHost = config.deviceHost || "";
        node.baseEndpoint = (config.baseEndpoint || "iot/v1").replace(/\/+$/, "");
        node.clientId = config.clientId || "";
        node.qos = parseInt(config.qos) || 1;

        // Auth settings
        node.authType = config.authType || "basic";
        node.username = (this.credentials && this.credentials.username) || "";
        node.password = (this.credentials && this.credentials.password) || "";
        node.caCertPath = config.caCertPath || "";
        node.clientCertPath = config.clientCertPath || "";
        node.clientKeyPath = config.clientKeyPath || "";

        // Proxy settings
        node.useProxy = config.useProxy || false;
        node.proxyUrl = config.proxyUrl || "";

        // Derived topics
        node.telemetryTopic = node.baseEndpoint + "/telemetry";
        node.cmdTopicPrefix = node.baseEndpoint + "/cmd/";
        node.rspTopicPrefix = node.baseEndpoint + "/rsp/";

        // State
        let client = null;
        let commandListeners = [];
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

            // CA certificate (optional — modern Node.js uses system CA store)
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

                // Subscribe to all command topics
                client.subscribe(node.cmdTopicPrefix + "#", { qos: node.qos }, function (err) {
                    if (err) {
                        node.error("Command subscribe failed: " + err.message);
                    } else {
                        node.log("Subscribed to " + node.cmdTopicPrefix + "#");
                    }
                });

                // Notify connection listeners
                connectionListeners.forEach(function (cb) { cb("connected"); });
            });

            client.on("message", function (topic, message) {
                if (topic.startsWith(node.cmdTopicPrefix)) {
                    var payload;
                    try {
                        payload = JSON.parse(message.toString());
                    } catch (e) {
                        payload = message.toString();
                    }

                    var commandKey = topic.substring(node.cmdTopicPrefix.length);

                    // Notify all command listeners
                    commandListeners.forEach(function (cb) {
                        cb(commandKey, payload, topic);
                    });
                }
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
            var pubOpts = Object.assign({ qos: node.qos }, opts || {});
            client.publish(topic, payload, pubOpts, callback);
        };

        /**
         * Send a response/ack for a command.
         * @param {string} commandKey - The command key from the command topic
         * @param {object} responsePayload - Response data
         * @param {function} [callback] - Called on publish complete
         */
        node.sendResponse = function (commandKey, responsePayload, callback) {
            var topic = node.rspTopicPrefix + commandKey;
            var payload = JSON.stringify(responsePayload);
            node.publish(topic, payload, {}, callback);
        };

        /**
         * Register a callback for incoming commands.
         * @param {function} callback - function(commandKey, payload, topic)
         */
        node.onCommand = function (callback) {
            commandListeners.push(callback);
        };

        /**
         * Unregister a command callback.
         */
        node.offCommand = function (callback) {
            commandListeners = commandListeners.filter(function (cb) { return cb !== callback; });
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

        // Connect immediately on node creation
        connect();

        // Cleanup on close
        node.on("close", function (done) {
            commandListeners = [];
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

    // =========================================================================
    // Test Connection HTTP endpoint
    // =========================================================================
    RED.httpAdmin.post("/iot-config/:id/test", RED.auth.needsPermission("iot-config.write"), function (req, res) {
        var configNode = RED.nodes.getNode(req.params.id);
        if (!configNode) {
            return res.status(404).json({ success: false, message: "Node not found. Deploy the flow first, then test." });
        }

        if (!configNode.deviceHost) {
            return res.json({ success: false, message: "No device host configured." });
        }

        // Test by creating a temporary MQTT connection
        var url = "mqtts://" + configNode.deviceHost + ":8883";
        var opts = {
            clientId: configNode.clientId + "_test_" + Date.now(),
            clean: true,
            protocol: "mqtts",
            port: 8883,
            connectTimeout: 15000,
            reconnectPeriod: 0   // Don't auto-reconnect for test
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
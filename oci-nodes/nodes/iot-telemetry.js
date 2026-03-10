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

    function IotTelemetryNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.iotDevice = RED.nodes.getNode(config.iotDevice);
        if (!node.iotDevice) {
            node.status({ fill: "red", shape: "ring", text: "no device config" });
            node.error("No IoT Device configured");
            return;
        }

        node.addTimestamp = config.addTimestamp !== false;  // Default true

        // Track connection state
        function onConnection(state) {
            switch (state) {
                case "connected":
                    node.status({ fill: "green", shape: "dot", text: "connected" });
                    break;
                case "reconnecting":
                    node.status({ fill: "yellow", shape: "ring", text: "reconnecting" });
                    break;
                case "offline":
                case "disconnected":
                    node.status({ fill: "red", shape: "ring", text: state });
                    break;
                case "error":
                    node.status({ fill: "red", shape: "dot", text: "error" });
                    break;
            }
        }
        node.iotDevice.onConnection(onConnection);

        // Set initial status
        if (node.iotDevice.isConnected()) {
            node.status({ fill: "green", shape: "dot", text: "connected" });
        } else {
            node.status({ fill: "yellow", shape: "ring", text: "connecting" });
        }

        node.on("input", function (msg, send, done) {
            if (!node.iotDevice.isConnected()) {
                node.status({ fill: "red", shape: "ring", text: "not connected" });
                var err = new Error("Not connected to IoT Platform");
                node.error(err.message, msg);
                return done(err);
            }

            var payload = msg.payload;
            if (typeof payload !== "object") {
                payload = { value: payload };
            }

            // Add timestamp in epoch microseconds if enabled and not already present
            if (node.addTimestamp && payload.time == null) {
                payload.time = Math.floor(Date.now() * 1000);
            }

            var payloadStr = JSON.stringify(payload);
            var topic = node.iotDevice.telemetryTopic;

            node.status({ fill: "yellow", shape: "dot", text: "publishing" });

            node.iotDevice.publish(topic, payloadStr, {}, function (err) {
                if (err) {
                    node.status({ fill: "red", shape: "dot", text: "publish failed" });
                    msg.error = err.message;
                    node.error("Publish failed: " + err.message, msg);
                    return done(err);
                }

                node.status({ fill: "green", shape: "dot", text: "published" });
                msg.topic = topic;
                send(msg);
                done();
            });
        });

        node.on("close", function () {
            node.iotDevice.offConnection(onConnection);
        });
    }

    RED.nodes.registerType("iot-telemetry", IotTelemetryNode);
};
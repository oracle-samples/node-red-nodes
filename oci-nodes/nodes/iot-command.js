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

    function IotCommandNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.iotDevice = RED.nodes.getNode(config.iotDevice);
        if (!node.iotDevice) {
            node.status({ fill: "red", shape: "ring", text: "no device config" });
            node.error("No IoT Device configured");
            return;
        }

        node.commandTopic = (config.topic || "").trim();
        if (!node.commandTopic) {
            node.status({ fill: "red", shape: "ring", text: "topic required" });
            node.error("Topic is required");
            return;
        }
        node.qos = parseInt(config.qos) || 1;

        function onConnection(state) {
            switch (state) {
                case "connected":
                    node.status({ fill: "green", shape: "dot", text: "listening" });
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

        if (node.iotDevice.isConnected()) {
            node.status({ fill: "green", shape: "dot", text: "listening" });
        } else {
            node.status({ fill: "yellow", shape: "ring", text: "connecting" });
        }

        /**
         * Extract a "command key" from the received topic given the subscription pattern.
         * - Pattern ending in /#  → key is the portion that matched #
         * - Fixed pattern (no wildcard) → key is the last topic segment
         */
        function extractCommandKey(pattern, receivedTopic) {
            if (pattern.endsWith("/#")) {
                var prefix = pattern.slice(0, -2);  // strip trailing /#
                if (receivedTopic.startsWith(prefix + "/")) {
                    return receivedTopic.slice(prefix.length + 1);
                }
                return receivedTopic;
            }
            // For fixed topics, use the last segment as the key.
            var parts = receivedTopic.split("/");
            return parts[parts.length - 1];
        }

        /**
         * Called by iot-config whenever a message arrives on a matching topic.
         * @param {string} receivedTopic - The actual MQTT topic the message arrived on
         * @param {*} payload - Parsed JSON or raw string
         */
        function onCommand(receivedTopic, payload) {
            var commandKey = extractCommandKey(node.commandTopic, receivedTopic);

            var msg = {
                payload: payload,
                commandKey: commandKey,
                topic: receivedTopic
            };

            node.status({ fill: "blue", shape: "dot", text: commandKey || receivedTopic });

            node.send(msg);

            // Restore listening status after a brief visual cue.
            setTimeout(function () {
                if (node.iotDevice.isConnected()) {
                    node.status({ fill: "green", shape: "dot", text: "listening" });
                }
            }, 2000);
        }

        node.iotDevice.subscribe(node.commandTopic, node.qos, onCommand);

        node.on("close", function () {
            node.iotDevice.unsubscribe(node.commandTopic, onCommand);
            node.iotDevice.offConnection(onConnection);
        });
    }

    RED.nodes.registerType("iot-command", IotCommandNode);
};

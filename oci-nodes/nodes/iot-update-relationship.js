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
    const iot = require("oci-iot");

    function isObject(value) {
        return value && typeof value === "object" && !Array.isArray(value);
    }

    // Parses the convenience key format "sourceTwinId->targetTwinId:contentPath"
    // into its components. The update API requires an internal relationship ID.
    function parseRelationshipKey(value) {
        var raw = String(value || "").trim();
        if (!raw) {
            throw new Error("Missing relationshipKey");
        }

        var arrow = raw.indexOf("->");
        var colon = raw.indexOf(":");
        if (arrow < 1 || colon <= arrow + 2 || colon >= raw.length - 1) {
            throw new Error("Invalid relationshipKey format. Expected sourceTwinId->targetTwinId:contentPath");
        }

        var source = raw.slice(0, arrow).trim();
        var target = raw.slice(arrow + 2, colon).trim();
        var contentPath = raw.slice(colon + 1).trim();

        if (!source || !target || !contentPath) {
            throw new Error("Invalid relationshipKey format. Expected sourceTwinId->targetTwinId:contentPath");
        }

        return {
            raw: raw,
            sourceDigitalTwinInstanceId: source,
            targetDigitalTwinInstanceId: target,
            contentPath: contentPath
        };
    }

    function IotUpdateRelationshipNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.ociConfig = RED.nodes.getNode(config.ociConfig);
        if (!node.ociConfig) {
            node.status({ fill: "red", shape: "ring", text: "no OCI config" });
            node.error("No OCI Config configured");
            return;
        }

        node.iotDomainId = String(config.iotDomainId || "").trim();
        node.defaultRelationshipKey = String(config.relationshipKey || "").trim();
        node.defaultContentRaw = String(config.content || "").trim();
        node.defaultContent = null;

        if (node.defaultContentRaw) {
            try {
                node.defaultContent = JSON.parse(node.defaultContentRaw);
                if (!isObject(node.defaultContent)) {
                    throw new Error("Default Content must be a JSON object");
                }
            } catch (err) {
                node.status({ fill: "red", shape: "ring", text: "invalid default content" });
                node.error("Invalid Default Content JSON: " + (err.message || String(err)));
                return;
            }
        }

        let client = null;

        async function getClient() {
            if (client) return client;
            const provider = await node.ociConfig.getAuthProvider();
            client = new iot.IotClient({
                authenticationDetailsProvider: provider
            });
            const region = node.ociConfig.getRegion();
            if (region) {
                client.regionId = region;
            }
            return client;
        }

        async function resolveRelationshipId(iotClient, iotDomainId, relationshipKey) {
            const parsed = parseRelationshipKey(relationshipKey);
            const response = await iotClient.listDigitalTwinRelationships({
                iotDomainId: iotDomainId,
                sourceDigitalTwinInstanceId: parsed.sourceDigitalTwinInstanceId,
                targetDigitalTwinInstanceId: parsed.targetDigitalTwinInstanceId,
                contentPath: parsed.contentPath,
                limit: 100
            });

            const items = (response && response.digitalTwinRelationshipCollection && response.digitalTwinRelationshipCollection.items) || [];
            if (items.length === 0) {
                throw new Error("No relationship found for key: " + parsed.raw);
            }
            if (items.length > 1) {
                throw new Error("Multiple relationships matched key: " + parsed.raw + ". Provide a more specific key.");
            }
            return items[0].id;
        }

        node.on("input", async function (msg, send, done) {
            var domainId = String((msg.iotDomainId !== undefined && msg.iotDomainId !== null) ? msg.iotDomainId : node.iotDomainId || "").trim();
            var relationshipKey = (msg.relationshipKey !== undefined && msg.relationshipKey !== null)
                ? msg.relationshipKey
                : node.defaultRelationshipKey;
            if ((relationshipKey === undefined || relationshipKey === null || relationshipKey === "") && isObject(msg.payload)) {
                relationshipKey = msg.payload.relationshipKey;
            }
            var content = (msg.content !== undefined)
                ? msg.content
                : (isObject(msg.payload) ? msg.payload.content : node.defaultContent);

            try {
                if (!domainId) {
                    throw new Error("No IoT Domain ID configured or provided in msg.iotDomainId");
                }
                if (!relationshipKey) {
                    throw new Error("Missing relationshipKey");
                }
                if (!isObject(content)) {
                    throw new Error("Missing or invalid content. Provide an object in msg.content or msg.payload.content");
                }

                node.status({ fill: "yellow", shape: "dot", text: "updating" });

                const iotClient = await getClient();
                const relationshipId = await resolveRelationshipId(iotClient, domainId, relationshipKey);
                const response = await iotClient.updateDigitalTwinRelationship({
                    digitalTwinRelationshipId: relationshipId,
                    updateDigitalTwinRelationshipDetails: {
                        content: content
                    }
                });

                node.status({ fill: "green", shape: "dot", text: "updated" });

                var outMsg = Object.assign({}, msg, {
                    operation: "updateRelationship",
                    iotDomainId: domainId,
                    relationshipKey: relationshipKey,
                    relationshipId: relationshipId,
                    statusCode: response.__httpStatusCode || 200,
                    payload: response.digitalTwinRelationship || response
                });

                send(outMsg);
                done();

                setTimeout(function () {
                    node.status({});
                }, 3000);
            } catch (err) {
                node.status({ fill: "red", shape: "dot", text: "update failed" });
                msg.error = {
                    message: err.message || String(err),
                    code: (err.statusCode || err.__httpStatusCode || null) ? String(err.statusCode || err.__httpStatusCode) : null
                };
                msg.statusCode = err.statusCode || err.__httpStatusCode || 0;
                msg.payload = err.message || String(err);
                node.error(msg.error.message, msg);
                done(err);
            }
        });
    }

    RED.nodes.registerType("iot-update-relationship", IotUpdateRelationshipNode);
};

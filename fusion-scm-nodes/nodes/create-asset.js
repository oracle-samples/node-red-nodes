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

module.exports = function(RED) {
    const axios = require("axios");
    const { HttpsProxyAgent } = require("https-proxy-agent");
    const { ensureHttps } = require("../lib/url.js");

    function CreateAsset(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.server = RED.nodes.getNode(config.server);
        if (!node.server) {
            node.status({ fill: "red", shape: "ring", text: "no SCM server" });
            node.error("No SCM Server configured");
            return;
        }

        // Parse structured mappings (JSON array from editor)
        const mappings = parseMappings(config.mappings);    
        const proxyAgent = buildProxyAgent(node.server);

        node.on("input", async (msg, send, done) => {
            try {
                node.status({ fill: "yellow", shape: "dot", text: "retrieving token..." });
                const token = await node.server.getToken();

                const url = node.server.buildUrl("installedBaseAssets");
                ensureHttps(url);

                const payload = resolvePayload(mappings, msg, RED);

                node.status({ fill: "yellow", shape: "dot", text: "creating..." });
                const response = await axios.post(url, payload, {
                    timeout: 30000,
                    httpsAgent: proxyAgent || undefined,
                    proxy: false,
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "Content-Type": "application/vnd.oracle.adf.resourceitem+json"
                    }
                });

                msg.statusCode = response.status;
                msg.payload = response.data;
                node.status({ fill: "green", shape: "dot", text: "created" });
                send(msg);
                done();
            } catch (err) {
                handleError(node, msg, err, send, done);
            }
        });
    }

    function parseMappings(raw) {
        if (Array.isArray(raw)) return raw;
        try { return JSON.parse(raw); } catch(e) { return []; }
    }

    function resolvePayload(mappings, msg, RED) {
        const payload = {};
        for (const m of mappings) {
            if (!m.scmField) continue;
            if (m.sourceType === "dequeued") {
                payload[m.scmField] = RED.util.getMessageProperty(msg, "dequeued." + (m.value || ""));
            } else if (m.sourceType === "msg") {
                payload[m.scmField] = RED.util.getMessageProperty(msg, m.value || "");
            } else {
                payload[m.scmField] = m.value || "";
            }
        }
        return payload;
    }

    function buildProxyAgent(server) {
        if (server.proxyUrl && server.useProxy) {
            return new HttpsProxyAgent(server.proxyUrl);
        }
        return null;
    }

    function handleError(node, msg, err, done) {
        node.status({ fill: "red", shape: "dot", text: "create failed" });
        msg.error = {
                    message: err.message || err.toString(),
                    code: (err.errorNum || err.statusCode || err.code || null) ? String(err.errorNum || err.statusCode || err.code) : null
                };
        msg.statusCode = err.response?.status || 0;
        msg.payload = err.response?.data || msg.error.message;
        node.error(msg.error.message, msg);
        done(err);
    }

    RED.nodes.registerType("create-asset", CreateAsset);
};

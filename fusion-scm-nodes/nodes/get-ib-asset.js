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

    function GetInstalledBaseAsset(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.server = RED.nodes.getNode(config.server);
        if (!node.server) {
            node.status({ fill: "red", shape: "ring", text: "No SCM server" });
            node.error("No SCM Server configured");
            return;
        }

        const proxyAgent = (node.server.proxyUrl && node.server.useProxy)
            ? new HttpsProxyAgent(node.server.proxyUrl) : null;

        node.on("input", async (msg, send, done) => {
            try {
                const paramValue = config.serialNumber || msg.serialNumber;
                if (!paramValue) {
                    node.status({ fill: "red", shape: "ring", text: "No SerialNumber" });
                    const err = new Error("No SerialNumber provided");
                    node.error(err.message, msg);
                    return done(err);
                }

                node.status({ fill: "yellow", shape: "dot", text: "retrieving token..." });
                const token = await node.server.getToken();

                const baseUrl = config.urlOverride || node.server.buildUrl("installedBaseAssets");
                const finalUrl = `${baseUrl}?q=SerialNumber=${paramValue}`;
                ensureHttps(finalUrl);

                node.status({ fill: "yellow", shape: "dot", text: "reading..." });
                const response = await axios.get(finalUrl, {
                    httpsAgent: proxyAgent || undefined,
                    proxy: false,
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "Content-Type": "application/json"
                    }
                });

                msg.statusCode = response.status;
                msg.payload = response.data;
                node.status({ fill: "green", shape: "dot", text: "found" });
                send(msg);
                done();
            } catch (err) {
                node.status({ fill: "red", shape: "dot", text: "read failed" });
                msg.error = err.message || err.toString();
                msg.statusCode = err.response?.status || 0;
                msg.payload = err.response?.data || msg.error;
                node.error(msg.error, msg);
                done(err);
            }
        });
    }

    RED.nodes.registerType("get-ib-asset", GetInstalledBaseAsset);
};
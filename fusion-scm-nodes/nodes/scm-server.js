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

    const axios = require("axios");
    const { HttpsProxyAgent } = require("https-proxy-agent");

    function ScmServerNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.tokenUrl = config.tokenUrl;
        node.hostname = config.hostname;
        node.version  = config.version;
        node.scope = config.scope;
        node.proxyUrl = config.proxyUrl;
        node.useProxy = !!config.useProxy;
        node.expiryMins = Number(config.tokenExpiryMins) || 60;

        node.username = this.credentials.username;
        node.password = this.credentials.password;

        node.accessToken = null;
        node.tokenExpiry = 0;

        let proxyAgent = null;
        if (node.proxyUrl && node.useProxy) {
            proxyAgent = new HttpsProxyAgent(node.proxyUrl);
        } 

        // fetch token
        async function fetchToken() {
            try {
                const basicAuth = Buffer
                    .from(`${node.username}:${node.password}`)
                    .toString("base64");

                const body = new URLSearchParams({
                    grant_type: "client_credentials",
                    scope: node.scope
                });

                const response = await axios.post(node.tokenUrl, body.toString(),
                    {   
                        httpAgent: proxyAgent || undefined,
                        proxy: false,
                        headers: {
                            "Authorization": "Basic " + basicAuth,
                            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
                        }
                    }
                );

                const data = response.data;
                node.accessToken = data.access_token;
                
                // convert from min to ms
                const expiryMs = node.expiryMins * 60 * 1000;
                node.tokenExpiry = Date.now() + expiryMs;

                return node.accessToken;

            } catch(err) {
                node.error("Token fetch failed: " + err.message);
                throw err;
            }
        }

        // public method for CRUD nodes
        node.getToken = async function () {
            const now = Date.now();

            // check if token is valid or expired
            if (!node.accessToken || now >= node.tokenExpiry) {
                return await fetchToken();
            }

            return node.accessToken;
        };
    }

    RED.nodes.registerType("scm-server", ScmServerNode, {
        credentials: {
            username: { type: "text" },
            password: { type: "password" }
        }
    });
};

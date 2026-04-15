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
    const { ensureHttps } = require("../lib/url.js");

    function ScmServerNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.tokenUrl  = config.tokenUrl;
        node.hostname  = config.hostname;
        node.version   = config.version;
        node.scope     = config.scope;
        node.proxyUrl  = config.proxyUrl;
        node.useProxy  = !!config.useProxy;
        node.expiryMins = Number(config.tokenExpiryMins) || 60;

        node.username = this.credentials.username;
        node.password = this.credentials.password;

        node.accessToken = null;
        node.tokenExpiry = 0;

        // Validate required fields at deploy time.
        const missing = [];
        if (!node.hostname)  missing.push("Hostname");
        if (!node.version)   missing.push("API Version");
        if (!node.tokenUrl)  missing.push("Token URL");
        if (!node.scope)     missing.push("Scope");
        if (missing.length > 0) {
            node.error("SCM Server missing required config: " + missing.join(", "));
            node.status({ fill: "red", shape: "ring", text: "misconfigured" });
            return;
        }

        // Enforce HTTPS on the token URL — credentials must not be sent over cleartext.
        try {
            ensureHttps(node.tokenUrl);
        } catch (e) {
            node.error("Token URL must use HTTPS: " + node.tokenUrl);
            node.status({ fill: "red", shape: "ring", text: "token URL not HTTPS" });
            return;
        }

        let proxyAgent = null;
        if (node.proxyUrl && node.useProxy) {
            proxyAgent = new HttpsProxyAgent(node.proxyUrl);
        }

        // In-flight token fetch — concurrent callers await this instead of each issuing a request.
        let _tokenPromise = null;

        async function fetchToken() {
            try {
                const basicAuth = Buffer
                    .from(`${node.username}:${node.password}`)
                    .toString("base64");

                const body = new URLSearchParams({
                    grant_type: "client_credentials",
                    scope: node.scope
                });

                const response = await axios.post(node.tokenUrl, body.toString(), {
                    timeout: 30000,
                    httpsAgent: proxyAgent || undefined,
                    proxy: false,
                    headers: {
                        "Authorization": "Basic " + basicAuth,
                        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
                    }
                });

                const data = response.data;
                node.accessToken = data.access_token;
                // Use expires_in with a 30-second buffer; fall back to tokenExpiryMins if absent.
                const expiresInMs = data.expires_in
                    ? Math.max(0, data.expires_in - 30) * 1000
                    : node.expiryMins * 60 * 1000;
                node.tokenExpiry = Date.now() + expiresInMs;
                return node.accessToken;
            } catch (err) {
                node.error("Token fetch failed: " + err.message);
                throw err;
            }
        }

        node.getToken = async function () {
            if (node.accessToken && Date.now() < node.tokenExpiry) {
                return node.accessToken;
            }
            // Deduplicate concurrent refreshes — wait for the in-flight fetch.
            if (_tokenPromise) {
                return await _tokenPromise;
            }
            _tokenPromise = fetchToken().finally(() => {
                _tokenPromise = null;
            });
            return await _tokenPromise;
        };

        /**
         * Builds the base URL for a given REST endpoint.
         * e.g. buildUrl("installedBaseAssets") => "https://hostname/fscmRestApi/resources/version/installedBaseAssets"
         */
        node.buildUrl = function (endpoint) {
            const baseUrl = new URL("https://" + String(node.hostname || "").trim());
            const encodedVersion = encodeURIComponent(String(node.version || "").trim());
            const endpointParts = String(endpoint || "")
                .split("/")
                .map((part) => part.trim())
                .filter(Boolean)
                .map((part) => encodeURIComponent(part));
            baseUrl.pathname = "/fscmRestApi/resources/" + encodedVersion + "/";
            if (endpointParts.length > 0) {
                baseUrl.pathname += endpointParts.join("/");
            }
            return baseUrl.toString();
        };
    }

    RED.nodes.registerType("scm-server", ScmServerNode, {
        credentials: {
            username: { type: "text" },
            password: { type: "password" }
        }
    });
};

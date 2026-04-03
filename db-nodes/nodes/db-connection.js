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
    const oracledb = require("oracledb");
    const common = require("oci-common");
    const identitydataplane = require("oci-identitydataplane");
    const { generateKeyPair } = require("crypto");
    const TOKEN_AUTH_TYPES = new Set([
        "config",
        "instancePrincipal",
        "resourcePrincipal",
        "sessionToken",
        "simple"
    ]);

    require('oracledb/plugins/token/extensionOci');

    function parseTokenExpiry(token) {
        const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(Buffer.from(base64, 'base64').toString('ascii')).exp * 1000;
    }

    let initializedDriverMode = null;
    let thickInitArgs = null;

    oracledb.events = true;

    function normalizeDriverMode(mode) {
        return (mode || "thick").toLowerCase() === "thin" ? "thin" : "thick";
    }

    function ensureDriverMode(node) {
        const requestedMode = normalizeDriverMode(node && node.driverMode);
        const nodeName = (node && node.name) || "db-connection";

        if (!initializedDriverMode) {
            if (requestedMode === "thick") {
                const envLibDir = (process.env.ORACLE_CLIENT_LIB || "").trim();
                const initArgs = envLibDir ? { libDir: envLibDir } : null;
                try {
                    if (initArgs) {
                        oracledb.initOracleClient(initArgs);
                    } else {
                        oracledb.initOracleClient();
                    }
                } catch (err) {
                    if (err && err.code === "NJS-118") {
                        throw new Error(
                            "Oracle driver mode conflict: Thin mode was already initialized in this Node-RED runtime before this db-connection requested Thick mode. Restart Node-RED and keep db-connection Driver Mode consistent."
                        );
                    }
                    throw err;
                }
                thickInitArgs = initArgs;
            }
            initializedDriverMode = requestedMode;
            return initializedDriverMode;
        }

        if (initializedDriverMode !== requestedMode) {
            if (node) {
                node.warn(
                    `Driver Mode '${requestedMode}' requested by '${nodeName}', but runtime is already in '${initializedDriverMode}' mode. Continuing with '${initializedDriverMode}'. Restart Node-RED to switch modes.`
                );
            }
            return initializedDriverMode;
        }

        if (requestedMode === "thick" && thickInitArgs) {
            oracledb.initOracleClient(thickInitArgs);
        }
        return initializedDriverMode;
    }

    function validateModeSpecificAuth(node, effectiveMode) {
        if (effectiveMode === "thick" && TOKEN_AUTH_TYPES.has(node.authType) && node.proxyUser) {
            throw new Error(
                "Proxy User is not supported with DB Token authentication while runtime is using Thick mode. Use Thin mode after a Node-RED restart, or clear Proxy User."
            );
        }
    }

    function DbConnectionNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.usePool = !!config.usePool;
        node.authType = config.authType;
        node.driverMode = normalizeDriverMode(config.driverMode);
        node.externalAuth = !!config.externalAuth;
        node.tnsString = config.tnsString || "";
        node.walletLocation = config.walletLocation || "";
        node.scope = config.scope || "";
        node.configFileLocation = config.configFileLocation || "";
        node.profile = config.profile || "";
        node.username = (this.credentials && this.credentials.username) || null;
        node.password = (this.credentials && this.credentials.password) || null;
        node.passphrase = (this.credentials && this.credentials.passphrase) || null;
        node.fingerprint = config.fingerprint || "";
        node.privateKeyLocation = config.privateKeyLocation || "";
        node.regionId = config.regionId || "";
        node.tenancyOCID = config.tenancyOCID || "";
        node.userOCID = config.userOCID || "";
        node.proxyUser = config.proxyUser || "";
        node.poolMin = Number(config.poolMin);
        node.poolMax = Number(config.poolMax);
        node.poolIncrement = Number(config.poolIncrement);
        node.queueTimeout = Number(config.queueTimeout);

        let pool = null;
        node.tokenCache = null;
        node.debug(`DB driver mode requested: ${node.driverMode}`);

        async function getTokenWithCache(refresh, config, buildProvider) {
            if (!refresh && node.tokenCache && Date.now() < node.tokenCache.expiry) {
                return { token: node.tokenCache.token, privateKey: node.tokenCache.privateKey };
            }
            const provider = await buildProvider();
            const client = new identitydataplane.DataplaneClient({
                authenticationDetailsProvider: provider
            });
            const keyPair = await new Promise((resolve, reject) => {
                generateKeyPair('rsa', {
                    modulusLength: 4096,
                    publicKeyEncoding: { type: 'spki', format: 'pem' },
                    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
                }, (err, publicKey, privateKey) => {
                    if (err) return reject(err);
                    resolve({ publicKey, privateKey });
                });
            });
            const response = await client.generateScopedAccessToken({
                generateScopedAccessTokenDetails: {
                    scope: config.scope || "urn:oracle:db::id::*",
                    publicKey: keyPair.publicKey
                }
            });
            const token = response.securityToken.token;
            node.tokenCache = {
                token,
                privateKey: keyPair.privateKey,
                expiry: parseTokenExpiry(token)
            };
            return { token, privateKey: keyPair.privateKey };
        }

        function getConnectString() {
            if (!node.tnsString || typeof node.tnsString !== "string") {
                throw new Error("Connect String is required");
            }
            return node.tnsString.trim();
        }

        function buildAuthTypes() {
            const connectString = getConnectString();
            const options = { connectString };
            const walletPath = String(node.walletLocation || "").trim();

            if (walletPath) {
                // Use wallet directory for Oracle Net config and wallet lookup.
                options.configDir = walletPath;
                options.walletLocation = walletPath;
            }

            switch (node.authType) {
                case "basic":
                    options.user = node.username;
                    options.password = node.password;
                    break;
                case "config":
                    options.tokenAuthConfigOci = {
                        authType: "configFileBasedAuthentication",
                        profile: node.profile || "DEFAULT",
                        configFileLocation: node.configFileLocation || "/home/opc/.oci/config",
                        scope: node.scope || undefined,
                    };
                    options.externalAuth = node.externalAuth;
                    if (node.proxyUser) options.user = `[${node.proxyUser}]`;
                    break;
                case "instancePrincipal":
                    options.tokenAuthConfigOci = {
                        authType: "instancePrincipal",
                        scope: node.scope || undefined,
                    };
                    options.externalAuth = node.externalAuth;
                    if (node.proxyUser) options.user = `[${node.proxyUser}]`;
                    break;
                case "resourcePrincipal":
                    options.accessToken = async function (_refresh, config) {
                        return getTokenWithCache(_refresh, config, () =>
                            common.ResourcePrincipalAuthenticationDetailsProvider.builder()
                        );
                    };
                    options.accessTokenConfig = {
                        scope: node.scope || undefined,
                    };
                    options.externalAuth = node.externalAuth;
                    if (node.proxyUser) options.user = `[${node.proxyUser}]`;
                    break;
                case "sessionToken":
                    options.accessToken = async function (_refresh, config) {
                        return getTokenWithCache(_refresh, config, () =>
                            new common.SessionAuthDetailProvider(config.configFileLocation, config.profile)
                        );
                    };
                    options.accessTokenConfig = {
                        configFileLocation: node.configFileLocation || "/home/opc/.oci/config",
                        profile: node.profile || "DEFAULT",
                        scope: node.scope || undefined,
                    };
                    options.externalAuth = node.externalAuth;
                    if (node.proxyUser) options.user = `[${node.proxyUser}]`;
                    break;
                case "simple":
                    options.tokenAuthConfigOci = {
                        authType: "simpleAuthentication",
                        fingerprint: node.fingerprint,
                        privateKeyLocation: node.privateKeyLocation,
                        passphrase: node.passphrase,
                        regionId: node.regionId,
                        tenancy: node.tenancyOCID,
                        user: node.userOCID,
                    };
                    options.externalAuth = node.externalAuth;
                    if (node.proxyUser) options.user = `[${node.proxyUser}]`;
                    break;
                default:
                    throw new Error(`Unsupported auth type: ${node.authType}`);
            }
            return options;
        }

        node.getStandaloneConnection = async function () {
            try {
                const effectiveMode = ensureDriverMode(node);
                validateModeSpecificAuth(node, effectiveMode);
                const options = buildAuthTypes();
                return await oracledb.getConnection(options);
            } catch (err) {
                node.error("DB Standalone Connection Failed: " + err.message);
                throw err;
            }
        };

        async function initPool() {
            if (!node.usePool) return;
            if (pool) return pool;
            const effectiveMode = ensureDriverMode(node);
            validateModeSpecificAuth(node, effectiveMode);
            const options = buildAuthTypes();
            Object.assign(options, {
                poolMin: node.poolMin,
                poolMax: node.poolMax,
                poolIncrement: node.poolIncrement,
                queueTimeout: node.queueTimeout,
            });
            pool = await oracledb.createPool(options);
            return pool;
        }

        node.getPoolConnection = async function () {
            const p = await initPool();
            if (!p) throw new Error("Pool is not enabled or failed");
            return await p.getConnection();
        };

        node.getConnection = async function () {
            if (!node.usePool) return node.getStandaloneConnection();
            return await node.getPoolConnection();
        };

        node.on("close", async (done) => {
            if (!pool) return done();
            try {
                await pool.close(10);
                node.debug("Connection pool closed");
            } catch (err) {
                node.warn(`Error closing pool: ${err.message}`);
            }
            done();
        });
    }

    RED.nodes.registerType("db-connection", DbConnectionNode, {
        credentials: {
            username: { type: "text" },
            password: { type: "password" },
            passphrase: { type: "password" }
        }
    });

    // Test Connection HTTP endpoint
    RED.httpAdmin.post("/db-connection/:id/test", RED.auth.needsPermission("db-connection.write"), async function (req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (!node) {
            return res.status(404).json({ success: false, message: "Node not found. Deploy the flow first, then test." });
        }
        let connection;
        try {
            connection = await node.getConnection();
            await connection.execute("SELECT 1 FROM DUAL");
            res.json({ success: true, message: "Connection successful" });
        } catch (err) {
            res.json({ success: false, message: err.message });
        } finally {
            if (connection) {
                try { await connection.close(); } catch (e) { /* ignore */ }
            }
        }
    });
};

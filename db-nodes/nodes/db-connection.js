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

    // Load the extensionOci token plugin from the oracledb package required for OCI token based auth
    require('oracledb/plugins/token/extensionOci')
    
    oracledb.events = true;
    
    oracledb.initOracleClient(
        { libDir: '/usr/lib/oracle/23/client64/lib' }
    );

    function DbConnectionNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.usePool = !!config.usePool;
        node.authType = config.authType;
        node.externalAuth = !!config.externalAuth;

        // basic auth (tns string)
        node.tnsString = config.tnsString || "";
        node.scope = config.scope || "";

        // config file auth
        node.configFileLocation = config.configFileLocation || "";
        node.profile = config.profile || "";

        // credentials
        node.username = (this.credentials && this.credentials.username) || null;
        node.password = (this.credentials && this.credentials.password) || null;
        node.passphrase = (this.credentials && this.credentials.passphrase) || null;

        // simple auth
        node.fingerprint = config.fingerprint || "";
        node.privateKeyLocation = config.privateKeyLocation || "";
        node.regionId = config.regionId || "";
        node.tenancyOCID = config.tenancyOCID || "";
        node.userOCID = config.userOCID || "";

        // pool options
        node.poolMin = Number(config.poolMin);
        node.poolMax = Number(config.poolMax);
        node.poolIncrement = Number(config.poolIncrement);
        node.queueTimeout = Number(config.queueTimeout);

        let pool = null;

        function getConnectString() {
            if (!node.tnsString || typeof node.tnsString !== "string") {
                throw new Error("Connect String is required");
            }
            return node.tnsString.trim();
        }


        function buildAuthTypes() {
            const connectString = getConnectString();

            const options = {
                connectString,
            };

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
                    break;

                case "instancePrincipal":
                    options.tokenAuthConfigOci = {
                        authType: "instancePrincipal",
                        scope: node.scope || undefined,
                    };
                    options.externalAuth = node.externalAuth;
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
                    break;

                default:
                    throw new Error(`Unsupported auth type: ${node.authType}`);
            }

            return options;
        }

        node.getStandaloneConnection = async function () {
            try {
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
            if (!p) {
                throw new Error("Pool is not enabled or failed");
            }
            return await p.getConnection();
        };

        node.getConnection = async function () {
            if (!node.usePool) {
                return node.getStandaloneConnection();
            }
            return await node.getPoolConnection();
        };

        node.on("close", async (done) => {
            if (!pool) return done();

            try {
                await pool.close(10); // 10 second drain timeout 
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
};


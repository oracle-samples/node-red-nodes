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
    const common = require("oci-common");

    function OciConfigNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.authType = config.authType || "config";
        node.region = config.region || "";
        node.compartmentOcid = config.compartmentOcid || "";

        // Config file auth
        node.configFilePath = config.configFilePath || "~/.oci/config";
        node.profile = config.profile || "DEFAULT";

        // Simple (API Key) auth — credentials stored securely
        node.tenancyOcid = config.tenancyOcid || "";
        node.userOcid = config.userOcid || "";
        node.fingerprint = config.fingerprint || "";
        node.privateKeyPath = config.privateKeyPath || "";
        node.passphrase = (this.credentials && this.credentials.passphrase) || null;

        let _authProvider = null;

        /**
         * Returns an OCI AuthenticationDetailsProvider based on the selected auth type.
         * Caches the provider after first creation.
         */
        node.getAuthProvider = function () {
            if (_authProvider) return _authProvider;

            switch (node.authType) {
                case "config":
                    _authProvider = new common.ConfigFileAuthenticationDetailsProvider(
                        node.configFilePath,
                        node.profile
                    );
                    break;

                case "instancePrincipal":
                    _authProvider = new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
                    break;

                case "resourcePrincipal":
                    _authProvider = new common.ResourcePrincipalAuthenticationDetailsProvider.builder();
                    break;

                case "simple":
                    _authProvider = new common.SimpleAuthenticationDetailsProvider(
                        node.tenancyOcid,
                        node.userOcid,
                        node.fingerprint,
                        node.privateKeyPath,
                        node.passphrase,
                        common.Region.fromRegionId(node.region)
                    );
                    break;

                default:
                    throw new Error("Unsupported OCI auth type: " + node.authType);
            }

            return _authProvider;
        };

        /**
         * Returns the configured region string (e.g. "us-ashburn-1").
         */
        node.getRegion = function () {
            return node.region;
        };

        /**
         * Returns the default compartment OCID if configured.
         */
        node.getCompartmentOcid = function () {
            return node.compartmentOcid;
        };
    }

    RED.nodes.registerType("oci-config", OciConfigNode, {
        credentials: {
            passphrase: { type: "password" }
        }
    });

    // Test Connection HTTP endpoint
    RED.httpAdmin.post("/oci-config/:id/test", RED.auth.needsPermission("oci-config.write"), async function (req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (!node) {
            return res.status(404).json({ success: false, message: "Node not found. Deploy the flow first, then test." });
        }
        try {
            const provider = node.getAuthProvider();

            // Verify the provider can resolve credentials by accessing identity
            const identity = new (require("oci-identity")).IdentityClient({
                authenticationDetailsProvider: provider
            });
            const region = node.getRegion();
            if (region) {
                identity.regionId = region;
            }

            // List availability domains as a lightweight test call
            const response = await identity.listRegions({});
            res.json({
                success: true,
                message: "Connected (" + response.items.length + " regions available)"
            });
        } catch (err) {
            res.json({ success: false, message: err.message });
        }
    });
};
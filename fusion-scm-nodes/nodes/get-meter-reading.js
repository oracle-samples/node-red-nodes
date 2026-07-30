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
    const scmQuery = require("../lib/scm-query.js");
    const scmError = require("../lib/scm-error.js");

    function GetMeterReading(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.server = RED.nodes.getNode(config.server);
        if (!node.server) {
            node.status({ fill: "red", shape: "ring", text: "no SCM server" });
            node.error("No SCM Server configured");
            return;
        }

        const proxyAgent = (node.server.proxyUrl && node.server.useProxy)
            ? new HttpsProxyAgent(node.server.proxyUrl) : null;

        node.on("input", async (msg, send, done) => {
            try {
                const assetNumber = msg.assetNumber || config.assetNumber;
                if (!hasValue(assetNumber)) {
                    const err = new Error("No AssetNumber provided");
                    return finishValidationError(node, msg, done, err, "no asset number");
                }
                const meterCode = msg.meterCode || config.meterCode;
                if (!hasValue(meterCode)) {
                    const err = new Error("No MeterCode provided");
                    return finishValidationError(node, msg, done, err, "no meter code");
                }

                let finder;
                try {
                    finder = scmQuery.buildMeterReadingFinder(assetNumber, meterCode);
                } catch (finderErr) {
                    return finishValidationError(node, msg, done, finderErr, "invalid finder");
                }

                const baseUrl = node.server.buildUrl("meterReadings");
                const parsed = new URL(baseUrl);
                parsed.searchParams.set("finder", finder);
                const finalUrl = parsed.toString();
                ensureHttps(finalUrl);

                node.status({ fill: "yellow", shape: "dot", text: "retrieving token..." });
                const token = await node.server.getToken();

                node.status({ fill: "yellow", shape: "dot", text: "reading..." });
                const requestOptions = {
                    timeout: 30000,
                    httpsAgent: proxyAgent || undefined,
                    proxy: false,
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "Content-Type": "application/json"
                    }
                };
                const response = await scmQuery.fetchAllCollectionPages(
                    finalUrl,
                    function (url) {
                        return axios.get(url, requestOptions);
                    }
                );

                msg.statusCode = response.status;
                msg.payload = response.data;
                if (isEmptyCollection(response.data)) {
                    node.status({ fill: "yellow", shape: "ring", text: "not found" });
                } else {
                    node.status({ fill: "green", shape: "dot", text: "found" });
                }
                send(msg);
                done();
            } catch (err) {
                scmError.handleNodeError(node, msg, err, done, { statusText: "read failed" });
            }
        });
    }

    function finishValidationError(node, msg, done, err, statusText) {
        node.status({ fill: "red", shape: "ring", text: statusText });
        msg.error = {
            message: err.message,
            code: null
        };
        node.error(err.message, msg);
        return done(err);
    }

    RED.nodes.registerType("get-meter-reading", GetMeterReading);

    function isEmptyCollection(data) {
        return data && Array.isArray(data.items) && data.items.length === 0;
    }

    function hasValue(value) {
        return value !== undefined && value !== null && String(value).trim() !== "";
    }
};

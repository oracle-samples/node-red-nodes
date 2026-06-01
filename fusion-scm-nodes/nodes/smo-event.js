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
    const scmError = require("../lib/scm-error.js");

    function SmoEventNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.server = RED.nodes.getNode(config.server);
        node.entityCode = config.entityCode || "";
        node.eventTypeCode = config.eventTypeCode || "";
        node.defaultEventTime = config.defaultEventTime !== false && config.defaultEventTime !== "false";

        if (!node.server) {
            node.status({ fill: "red", shape: "ring", text: "no SCM server" });
            node.error("No SCM Server configured");
            return;
        }

        const proxyAgent = (node.server.proxyUrl && node.server.useProxy)
            ? new HttpsProxyAgent(node.server.proxyUrl)
            : null;

        node.on("input", async (msg, send, done) => {
            try {
                const eventPayload = buildEventPayload(node, msg);

                node.status({ fill: "yellow", shape: "dot", text: "retrieving token..." });
                const token = await node.server.getToken();

                const url = node.server.buildSmartOperationsUrl("events");
                ensureHttps(url);

                node.status({ fill: "yellow", shape: "dot", text: "sending event..." });
                const response = await axios.post(url, eventPayload, {
                    timeout: 30000,
                    httpsAgent: proxyAgent || undefined,
                    proxy: false,
                    headers: {
                        "Authorization": "Bearer " + token,
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    }
                });

                const outMsg = Object.assign({}, msg, {
                    payload: response.data,
                    statusCode: response.status,
                    smoEvent: eventPayload
                });
                reattachTransaction(msg, outMsg);

                node.status({ fill: "green", shape: "dot", text: "sent" });
                send(outMsg);
                done();
            } catch (err) {
                const isValidationError = err && err.smoValidationError;
                scmError.handleNodeError(node, msg, err, done, {
                    statusText: isValidationError ? "invalid event" : "send failed",
                    statusShape: isValidationError ? "ring" : "dot"
                });
            }
        });
    }

    function buildEventPayload(node, msg) {
        const source = resolveSourceEvent(msg);
        const entityCode = resolveNonEmpty(msg.entityCode, source.entityCode, node.entityCode);
        const eventTypeCode = resolveNonEmpty(msg.eventTypeCode, source.eventTypeCode, node.eventTypeCode);
        let eventTime = resolveNonEmpty(msg.eventTime, source.eventTime, "");
        const data = msg.data !== undefined ? msg.data : (source.data !== undefined ? source.data : {});

        if (!entityCode) {
            throwValidationError("Smart Operations event requires entityCode");
        }
        if (!eventTypeCode) {
            throwValidationError("Smart Operations event requires eventTypeCode");
        }
        if (!eventTime && node.defaultEventTime) {
            eventTime = new Date().toISOString();
        }
        if (!eventTime) {
            throwValidationError("Smart Operations event requires eventTime");
        }
        if (!isPlainObject(data)) {
            throwValidationError("Smart Operations event data must be an object");
        }

        return {
            entityCode: String(entityCode),
            eventTypeCode: String(eventTypeCode),
            eventTime: String(eventTime),
            data: data
        };
    }

    function resolveSourceEvent(msg) {
        if (msg.smoEvent !== undefined) {
            if (!isPlainObject(msg.smoEvent)) {
                throwValidationError("msg.smoEvent must be an object");
            }
            return msg.smoEvent;
        }
        if (isPlainObject(msg.payload)) {
            return msg.payload;
        }
        return {};
    }

    function resolveNonEmpty() {
        for (let i = 0; i < arguments.length; i++) {
            const value = arguments[i];
            if (value !== undefined && value !== null && value !== "") {
                return value;
            }
        }
        return "";
    }

    function isPlainObject(value) {
        return Object.prototype.toString.call(value) === "[object Object]";
    }

    function throwValidationError(message) {
        const err = new Error(message);
        err.smoValidationError = true;
        throw err;
    }

    function reattachTransaction(msg, outMsg) {
        if (msg.transaction) {
            Object.defineProperty(outMsg, "transaction", {
                value: msg.transaction,
                enumerable: false,
                writable: true,
                configurable: true
            });
        }
    }

    RED.nodes.registerType("smo-event", SmoEventNode);
};

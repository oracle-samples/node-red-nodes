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
    const objectstorage = require("oci-objectstorage");
    const fs = require("fs");
    const stream = require("stream");

    async function streamToBuffer(value) {
        if (Buffer.isBuffer(value)) {
            return value;
        }

        if (!value) {
            return Buffer.alloc(0);
        }

        if (typeof value.arrayBuffer === "function") {
            const ab = await value.arrayBuffer();
            return Buffer.from(ab);
        }

        if (typeof value.getReader === "function") {
            const reader = value.getReader();
            const chunks = [];
            while (true) {
                const result = await reader.read();
                if (result.done) break;
                chunks.push(Buffer.from(result.value));
            }
            return Buffer.concat(chunks);
        }

        if (value instanceof stream.Readable) {
            return new Promise((resolve, reject) => {
                const chunks = [];
                value.on("data", (chunk) => {
                    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                });
                value.on("end", () => resolve(Buffer.concat(chunks)));
                value.on("error", reject);
            });
        }

        return Buffer.from(String(value));
    }

    function OciObjectStorageNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.ociConfig = RED.nodes.getNode(config.ociConfig);
        if (!node.ociConfig) {
            node.status({ fill: "red", shape: "ring", text: "no OCI config" });
            node.error("No OCI Config configured");
            return;
        }

        node.operation = config.operation || "upload";
        node.namespace = config.namespace || "";
        node.bucketName = config.bucketName || "";
        node.objectName = config.objectName || "";
        node.filePath = config.filePath || "";
        node.contentType = config.contentType || "";
        node.downloadOutput = config.downloadOutput || "buffer";
        node.encoding = config.encoding || "utf8";

        let client = null;

        async function getClient() {
            if (client) return client;
            const provider = await node.ociConfig.getAuthProvider();
            client = new objectstorage.ObjectStorageClient({
                authenticationDetailsProvider: provider
            });
            const region = node.ociConfig.getRegion();
            if (region) {
                client.regionId = region;
            }
            return client;
        }

        function resolveValue(configValue, msgValue) {
            return (msgValue !== undefined && msgValue !== null && msgValue !== "") ? msgValue : configValue;
        }

        node.on("input", async function (msg, send, done) {
            try {
                const operation = resolveValue(node.operation, msg.operation) || "upload";
                const namespace = resolveValue(node.namespace, msg.namespace);
                const bucketName = resolveValue(node.bucketName, msg.bucketName);
                const objectName = resolveValue(node.objectName, msg.objectName);
                const filePath = resolveValue(node.filePath, msg.filePath);
                const contentType = resolveValue(node.contentType, msg.contentType);
                const downloadOutput = resolveValue(node.downloadOutput, msg.downloadOutput) || "buffer";
                const encoding = resolveValue(node.encoding, msg.encoding) || "utf8";

                if (!namespace) {
                    const err = new Error("No namespace configured or provided in msg.namespace");
                    node.status({ fill: "red", shape: "ring", text: "no namespace" });
                    node.error(err.message, msg);
                    return done(err);
                }

                if (!bucketName) {
                    const err = new Error("No bucket name configured or provided in msg.bucketName");
                    node.status({ fill: "red", shape: "ring", text: "no bucket" });
                    node.error(err.message, msg);
                    return done(err);
                }

                if (!objectName) {
                    const err = new Error("No object name configured or provided in msg.objectName");
                    node.status({ fill: "red", shape: "ring", text: "no object" });
                    node.error(err.message, msg);
                    return done(err);
                }

                const osClient = await getClient();

                if (operation === "upload") {
                    node.status({ fill: "yellow", shape: "dot", text: "uploading" });

                    let uploadBody = msg.payload;
                    const hasPayload = msg.payload !== undefined && msg.payload !== null;

                    if (!hasPayload) {
                        if (!filePath) {
                            const err = new Error("No upload body found in msg.payload and no file path configured/provided");
                            node.status({ fill: "red", shape: "ring", text: "no upload body" });
                            node.error(err.message, msg);
                            return done(err);
                        }
                        uploadBody = await fs.promises.readFile(filePath);
                    } else if (
                        Buffer.isBuffer(uploadBody) ||
                        typeof uploadBody === "string" ||
                        uploadBody instanceof stream.Readable ||
                        typeof uploadBody.getReader === "function" ||
                        typeof uploadBody.arrayBuffer === "function"
                    ) {
                    } else if (uploadBody instanceof Uint8Array) {
                        uploadBody = Buffer.from(uploadBody);
                    } else {
                        uploadBody = JSON.stringify(uploadBody);
                    }

                    const request = {
                        namespaceName: namespace,
                        bucketName: bucketName,
                        objectName: objectName,
                        putObjectBody: uploadBody
                    };

                    if (contentType) {
                        request.contentType = contentType;
                    }

                    if (Buffer.isBuffer(uploadBody)) {
                        request.contentLength = uploadBody.length;
                    } else if (typeof uploadBody === "string") {
                        request.contentLength = Buffer.byteLength(uploadBody, "utf8");
                    }

                    const response = await osClient.putObject(request);

                    msg.payload = {
                        eTag: response.eTag || null,
                        versionId: response.versionId || null,
                        opcRequestId: response.opcRequestId || null,
                        statusCode: response.__httpStatusCode || 200
                    };
                    msg.statusCode = response.__httpStatusCode || 200;

                    node.status({ fill: "green", shape: "dot", text: "uploaded" });
                    send(msg);
                    done();

                } else if (operation === "download") {
                    node.status({ fill: "yellow", shape: "dot", text: "downloading" });

                    const response = await osClient.getObject({
                        namespaceName: namespace,
                        bucketName: bucketName,
                        objectName: objectName
                    });

                    const bodyBuffer = await streamToBuffer(response.value);
                    let downloadedContent;
                    if (downloadOutput === "text") {
                        downloadedContent = bodyBuffer.toString(encoding);
                    } else {
                        downloadedContent = bodyBuffer;
                    }

                    msg.savedToPath = null;
                    if (filePath) {
                        await fs.promises.writeFile(filePath, bodyBuffer);
                        msg.savedToPath = filePath;
                        msg.payload = {
                            content: downloadedContent,
                            savedToPath: msg.savedToPath,
                            outputType: downloadOutput
                        };
                    } else {
                        msg.payload = downloadedContent;
                    }

                    msg.eTag = response.eTag || null;
                    msg.contentType = response.contentType || null;
                    msg.contentLength = response.contentLength || 0;
                    msg.versionId = response.versionId || null;
                    msg.opcRequestId = response.opcRequestId || null;
                    msg.statusCode = response.__httpStatusCode || 200;

                    node.status({ fill: "green", shape: "dot", text: "downloaded" });
                    send(msg);
                    done();

                } else {
                    const err = new Error("Unsupported operation: " + operation + ". Use 'upload' or 'download'.");
                    node.status({ fill: "red", shape: "ring", text: "invalid operation" });
                    node.error(err.message, msg);
                    return done(err);
                }

                setTimeout(function () {
                    node.status({});
                }, 3000);

            } catch (err) {
                node.status({ fill: "red", shape: "dot", text: "failed" });
                msg.error = err.message || err.toString();
                msg.statusCode = err.statusCode || 0;
                msg.payload = err.message;
                node.error(msg.error, msg);
                done(err);
            }
        });
    }

    RED.nodes.registerType("oci-object-storage", OciObjectStorageNode);
};

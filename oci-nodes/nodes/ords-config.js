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
    const RESERVED_OBJECT_KEYS = ["__proto__", "constructor", "prototype"];

    function parsePositiveInt(value, fallback, minimum, maximum) {
        var parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < minimum) return fallback;
        parsed = Math.floor(parsed);
        if (maximum && parsed > maximum) return maximum;
        return parsed;
    }

    function ensureHttpsUrl(value, fieldName) {
        var url;
        try {
            url = new URL(String(value || "").trim());
        } catch (err) {
            throw new Error(fieldName + " must be a valid HTTPS URL");
        }
        if (url.protocol !== "https:") {
            throw new Error(fieldName + " must use HTTPS");
        }
        return url;
    }

    function isAbsoluteUrl(value) {
        return /^[a-z][a-z0-9+.-]*:/i.test(String(value || "")) || String(value || "").indexOf("//") === 0;
    }

    function createCloseError() {
        var err = new Error("ORDS request canceled because the config node closed");
        err.code = "ORDS_NODE_CLOSED";
        return err;
    }

    function createTimeoutError() {
        var err = new Error("ORDS request timed out");
        err.code = "ETIMEDOUT";
        return err;
    }

    function hasReservedObjectKeys(value) {
        return Object.keys(value || {}).some(function (key) {
            return RESERVED_OBJECT_KEYS.indexOf(key) !== -1;
        });
    }

    function assertPlainObject(value, label) {
        if (value === undefined || value === null || value === "") return {};
        if (typeof value !== "object" || Array.isArray(value)) {
            throw new Error(label + " must be an object");
        }
        if (hasReservedObjectKeys(value)) {
            throw new Error(label + " must not contain reserved keys");
        }
        return value;
    }

    function normalizeHeaderValue(value, label) {
        if (Array.isArray(value)) {
            return value.map(function (item) {
                return normalizeHeaderValue(item, label);
            }).join(", ");
        }
        if (value === undefined || value === null || typeof value === "object") {
            throw new Error(label + " must be a string, number, boolean, or array of those values");
        }
        return String(value);
    }

    function normalizeHeadersObject(headers, label) {
        var source = assertPlainObject(headers, label);
        var normalized = {};
        Object.keys(source).forEach(function (key) {
            normalized[key] = normalizeHeaderValue(source[key], label + "." + key);
        });
        return normalized;
    }

    function mergeHeaders() {
        var merged = {};
        var namesByLowerCase = {};
        Array.prototype.slice.call(arguments).forEach(function (headers) {
            Object.keys(headers || {}).forEach(function (key) {
                var name = String(key);
                var lowerName = name.toLowerCase();
                var previousName = namesByLowerCase[lowerName];
                if (previousName && previousName !== name) {
                    delete merged[previousName];
                }
                namesByLowerCase[lowerName] = name;
                merged[name] = headers[key];
            });
        });
        return merged;
    }

    function normalizeMethod(value, allowedMethods) {
        var method = String(value || "GET").trim().toUpperCase();
        var allowed = allowedMethods || ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
        if (allowed.indexOf(method) === -1) {
            throw new Error("Unsupported ORDS method: " + method);
        }
        return method;
    }

    function resolveQuery(value) {
        if (value === undefined || value === null || value === "") return undefined;
        if (typeof value === "string") {
            var trimmed = value.trim();
            if (!trimmed) return undefined;
            try {
                var parsed = JSON.parse(trimmed);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    assertPlainObject(parsed, "Query");
                }
                return JSON.stringify(parsed);
            } catch (err) {
                if (/reserved keys|must be an object/.test(err.message || "")) throw err;
                return trimmed;
            }
        }
        if (typeof value === "object") {
            if (!Array.isArray(value)) {
                assertPlainObject(value, "msg.query");
            }
            return JSON.stringify(value);
        }
        return String(value);
    }

    function encodeRelativePath(path) {
        var raw = String(path || "").trim();
        var queryIndex = raw.indexOf("?");
        var pathOnly = queryIndex >= 0 ? raw.slice(0, queryIndex) : raw;
        var queryOnly = queryIndex >= 0 ? raw.slice(queryIndex + 1) : "";
        var encodedPath = pathOnly
            .replace(/^\/+/, "")
            .split("/")
            .filter(function (part) { return part !== ""; })
            .map(function (part) { return encodeURIComponent(decodeURIComponent(part)); })
            .join("/");
        return {
            path: encodedPath,
            query: queryOnly
        };
    }

    async function readResponseBody(response) {
        var text = await response.text();
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch (err) {
            return text;
        }
    }

    function collectHeaders(headers) {
        var result = {};
        if (headers && typeof headers.forEach === "function") {
            headers.forEach(function (value, key) {
                result[key] = value;
            });
        }
        return result;
    }

    function getHeaderValue(headers, name) {
        var lowerName = String(name || "").toLowerCase();
        var value = null;
        Object.keys(headers || {}).forEach(function (key) {
            if (String(key).toLowerCase() === lowerName) {
                value = headers[key];
            }
        });
        return value;
    }

    function OrdsConfigNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.baseUrl = String(config.baseUrl || "").trim();
        node.tokenUrl = String(config.tokenUrl || "").trim();
        node.scope = String(config.scope || "").trim();
        node.requestTimeoutMs = parsePositiveInt(config.requestTimeoutMs, 30000, 1000, 300000);
        node.tokenExpiryFallbackMins = parsePositiveInt(config.tokenExpiryFallbackMins, 60, 1, 1440);
        node.maxConcurrentPolls = parsePositiveInt(config.maxConcurrentPolls, 5, 1, 100);
        node.maxQueuedPolls = parsePositiveInt(config.maxQueuedPolls, 100, 0, 10000);

        node.clientId = (this.credentials && this.credentials.clientId) || "";
        node.clientSecret = (this.credentials && this.credentials.clientSecret) || "";

        node.accessToken = null;
        node.tokenExpiry = 0;

        var missing = [];
        if (!node.baseUrl) missing.push("Base URL");
        if (!node.tokenUrl) missing.push("Token URL");
        if (!node.clientId) missing.push("Client ID");
        if (!node.clientSecret) missing.push("Client Secret");
        if (missing.length > 0) {
            node.ordsConfigError = "ORDS Config missing required config: " + missing.join(", ");
            node.status({ fill: "red", shape: "ring", text: "misconfigured" });
            node.error(node.ordsConfigError);
            return;
        }

        try {
            node._baseUrl = ensureHttpsUrl(node.baseUrl, "Base URL");
            ensureHttpsUrl(node.tokenUrl, "Token URL");
        } catch (err) {
            node.ordsConfigError = err.message;
            node.status({ fill: "red", shape: "ring", text: "invalid URL" });
            node.error(err.message);
            return;
        }

        let tokenPromise = null;
        let activePolls = 0;
        const pollQueue = [];
        const activeRequestControllers = new Set();
        let closing = false;

        function ensureOpen() {
            if (closing) {
                throw createCloseError();
            }
        }

        async function fetchWithTimeout(url, options, timeoutMs) {
            ensureOpen();
            const controller = new AbortController();
            activeRequestControllers.add(controller);
            const timer = setTimeout(function () {
                controller.abort();
            }, timeoutMs);
            try {
                var requestOptions = Object.assign({}, options, {
                    signal: controller.signal
                });
                return await fetch(url, requestOptions);
            } catch (err) {
                if (controller.signal.aborted) {
                    if (closing) {
                        throw createCloseError();
                    }
                    throw createTimeoutError();
                }
                throw err;
            } finally {
                clearTimeout(timer);
                activeRequestControllers.delete(controller);
            }
        }

        async function fetchToken() {
            ensureOpen();
            const body = new URLSearchParams({
                grant_type: "client_credentials"
            });
            if (node.scope) {
                body.set("scope", node.scope);
            }

            const response = await fetchWithTimeout(node.tokenUrl, {
                method: "POST",
                headers: {
                    Authorization: "Basic " + Buffer.from(node.clientId + ":" + node.clientSecret).toString("base64"),
                    Accept: "application/json",
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: body.toString()
            }, node.requestTimeoutMs);

            const data = await readResponseBody(response);
            if (!response.ok) {
                const err = new Error("ORDS token request failed with status " + response.status);
                err.statusCode = response.status;
                err.responseData = data;
                throw err;
            }
            if (!data || !data.access_token) {
                throw new Error("ORDS token response did not include access_token");
            }

            node.accessToken = data.access_token;
            var expiresIn = Number(data.expires_in);
            var expiresMs = Number.isFinite(expiresIn) && expiresIn > 30
                ? (expiresIn - 30) * 1000
                : node.tokenExpiryFallbackMins * 60 * 1000;
            node.tokenExpiry = Date.now() + expiresMs;
            return node.accessToken;
        }

        node.getToken = async function (forceRefresh) {
            ensureOpen();
            if (!forceRefresh && node.accessToken && Date.now() < node.tokenExpiry) {
                return node.accessToken;
            }
            if (tokenPromise) {
                return await tokenPromise;
            }
            tokenPromise = fetchToken().finally(function () {
                tokenPromise = null;
            });
            return await tokenPromise;
        };

        node.assertPlainObject = assertPlainObject;
        node.mergeHeaders = mergeHeaders;
        node.normalizeHeadersObject = normalizeHeadersObject;
        node.normalizeMethod = normalizeMethod;
        node.resolveQuery = resolveQuery;
        node.assertRelativePath = function (path) {
            if (isAbsoluteUrl(path)) {
                throw new Error("Custom ORDS endpoints must be a relative ORDS path");
            }
        };
        node.buildQueryParams = function (configQuery, msg) {
            var queryParams = {};
            var query = msg.query !== undefined ? msg.query : configQuery;
            var resolvedQuery = resolveQuery(query);
            if (resolvedQuery !== undefined) {
                queryParams.q = resolvedQuery;
            }
            if (msg.queryParams && typeof msg.queryParams === "object" && !Array.isArray(msg.queryParams)) {
                var runtimeQueryParams = assertPlainObject(msg.queryParams, "msg.queryParams");
                Object.keys(runtimeQueryParams).forEach(function (key) {
                    queryParams[key] = runtimeQueryParams[key];
                });
            }
            return queryParams;
        };

        node.buildUrl = function (relativePath, queryParams) {
            var rawPath = String(relativePath || "").trim();
            if (!rawPath) {
                throw new Error("ORDS path is required");
            }
            node.assertRelativePath(rawPath);

            var base = new URL(node._baseUrl.toString());
            if (!base.pathname.endsWith("/")) {
                base.pathname += "/";
            }

            var encoded = encodeRelativePath(rawPath);
            var url = new URL(encoded.path, base);
            if (encoded.query) {
                var embeddedParams = new URLSearchParams(encoded.query);
                embeddedParams.forEach(function (value, key) {
                    url.searchParams.set(key, value);
                });
            }
            var safeQueryParams = assertPlainObject(queryParams || {}, "queryParams");
            Object.keys(safeQueryParams).forEach(function (key) {
                var value = safeQueryParams[key];
                if (value === undefined || value === null || value === "") return;
                if (typeof value === "object") {
                    value = JSON.stringify(value);
                }
                url.searchParams.set(key, String(value));
            });
            return url.toString();
        };

        node.request = async function (options) {
            ensureOpen();
            options = options || {};
            var method = normalizeMethod(options.method || "GET");
            var url = node.buildUrl(options.path, assertPlainObject(options.queryParams || {}, "queryParams"));
            var userHeaders = normalizeHeadersObject(options.headers || {}, "headers");
            var baseHeaders = mergeHeaders({
                Accept: "application/json"
            }, userHeaders);
            var body;
            if (options.body !== undefined && method !== "GET" && method !== "HEAD") {
                body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
                if (!getHeaderValue(baseHeaders, "content-type")) {
                    baseHeaders = mergeHeaders(baseHeaders, {
                        "Content-Type": "application/json"
                    });
                }
            }

            async function requestWithToken(token) {
                var headers = mergeHeaders(baseHeaders, {
                    Authorization: "Bearer " + token
                });
                var response = await fetchWithTimeout(url, {
                    method: method,
                    headers: headers,
                    body: body
                }, node.requestTimeoutMs);
                var data = await readResponseBody(response);
                return {
                    ok: response.ok,
                    statusCode: response.status,
                    headers: collectHeaders(response.headers),
                    data: data,
                    url: url
                };
            }

            var result = await requestWithToken(await node.getToken(false));
            if (result.statusCode === 401) {
                result = await requestWithToken(await node.getToken(true));
            }
            if (!result.ok) {
                var err = new Error("ORDS request failed with status " + result.statusCode);
                err.statusCode = result.statusCode;
                err.response = result;
                throw err;
            }
            return result;
        };

        function rejectPollQueue(err) {
            while (pollQueue.length > 0) {
                pollQueue.shift().reject(err);
            }
        }

        function drainPollQueue() {
            if (closing) {
                rejectPollQueue(createCloseError());
                return;
            }
            while (activePolls < node.maxConcurrentPolls && pollQueue.length > 0) {
                var item = pollQueue.shift();
                activePolls += 1;
                Promise.resolve()
                    .then(item.task)
                    .then(item.resolve, item.reject)
                    .finally(function () {
                        activePolls -= 1;
                        drainPollQueue();
                    });
            }
        }

        node.runPollJob = function (task) {
            return new Promise(function (resolve, reject) {
                if (closing) {
                    reject(createCloseError());
                    return;
                }
                if (pollQueue.length >= node.maxQueuedPolls && activePolls >= node.maxConcurrentPolls) {
                    reject(new Error("ORDS poll queue is full"));
                    return;
                }
                pollQueue.push({ task: task, resolve: resolve, reject: reject });
                drainPollQueue();
            });
        };

        node.on("close", function (_removed, done) {
            closing = true;
            activeRequestControllers.forEach(function (controller) {
                controller.abort();
            });
            activeRequestControllers.clear();
            rejectPollQueue(createCloseError());
            if (typeof done === "function") {
                done();
            }
        });
    }

    RED.nodes.registerType("ords-config", OrdsConfigNode, {
        credentials: {
            clientId: { type: "text" },
            clientSecret: { type: "password" }
        }
    });

    RED.httpAdmin.post("/ords-config/:id/test", RED.auth.needsPermission("ords-config.write"), async function (req, res) {
        const node = RED.nodes.getNode(req.params.id);
        if (!node) {
            return res.status(404).json({ success: false, message: "Node not found. Deploy the flow first, then test." });
        }
        if (typeof node.getToken !== "function") {
            return res.json({
                success: false,
                message: node.ordsConfigError || "ORDS Config is not ready. Check deploy errors for missing or invalid settings."
            });
        }
        try {
            await node.getToken();
            res.json({ success: true, message: "Token request succeeded" });
        } catch (err) {
            res.json({ success: false, message: err.message || String(err) });
        }
    });
};

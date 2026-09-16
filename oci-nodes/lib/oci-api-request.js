var common = require("oci-common");

var ALLOWED_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];
var BODY_METHODS = ["POST", "PUT", "PATCH"];
var PROTECTED_HEADERS = {
    authorization: true,
    host: true,
    "x-date": true,
    date: true,
    "content-length": true,
    "x-content-sha256": true,
    "opc-obo-token": true
};
var RESERVED_KEYS = ["__proto__", "prototype", "constructor"];

function validationError(message) {
    var err = new Error(message);
    err.isValidationError = true;
    return err;
}

function parseObject(value, label) {
    if (value === undefined || value === null || value === "") return {};
    var parsed;
    try {
        parsed = typeof value === "string" ? JSON.parse(value) : value;
    } catch (err) {
        throw validationError(label + " must be a valid JSON object");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw validationError(label + " must be a JSON object");
    }
    Object.keys(parsed).forEach(function (key) {
        if (RESERVED_KEYS.indexOf(key) !== -1) {
            throw validationError(label + " cannot contain reserved key " + key);
        }
    });
    return parsed;
}

function normalizeMethod(value) {
    var method = String(value || "GET").trim().toUpperCase();
    if (ALLOWED_METHODS.indexOf(method) === -1) {
        throw validationError("Unsupported OCI API method: " + method);
    }
    return method;
}

function validateEndpoint(value) {
    var endpoint;
    try {
        endpoint = new URL(String(value || ""));
    } catch (err) {
        throw validationError("Endpoint must be a valid HTTPS URL");
    }
    if (endpoint.protocol !== "https:") {
        throw validationError("Endpoint must use HTTPS");
    }
    if (endpoint.username || endpoint.password) {
        throw validationError("Endpoint must not contain credentials");
    }
    if (endpoint.hash) {
        throw validationError("Endpoint must not contain a fragment");
    }

    var hostname = endpoint.hostname.toLowerCase();
    var allowed = common.Realm.values().some(function (realm) {
        var domain = String(realm.secondLevelDomain || "").toLowerCase();
        return domain && (hostname === domain || hostname.endsWith("." + domain));
    });
    if (!allowed) {
        throw validationError("Endpoint hostname must belong to a known OCI realm domain");
    }
    return endpoint;
}

function appendPath(endpoint, pathValue) {
    if (pathValue === undefined || pathValue === null || pathValue === "") return endpoint;
    var rawPath = String(pathValue).trim();
    if (!rawPath) return endpoint;
    if (/^[a-z][a-z0-9+.-]*:/i.test(rawPath) || rawPath.startsWith("//")) {
        throw validationError("OCI API path must be relative");
    }

    var parsedPath = new URL(rawPath, "https://path.invalid/");
    if (parsedPath.hash) {
        throw validationError("OCI API path must not contain a fragment");
    }
    var basePath = endpoint.pathname || "/";
    if (!basePath.endsWith("/")) basePath += "/";
    var relativePath = parsedPath.pathname.replace(/^\/+/, "");
    endpoint.pathname = basePath + relativePath;
    parsedPath.searchParams.forEach(function (value, key) {
        endpoint.searchParams.append(key, value);
    });
    return endpoint;
}

function appendQueryMap(endpoint, query) {
    Object.keys(query).forEach(function (key) {
        var value = query[key];
        endpoint.searchParams.delete(key);
        if (value === undefined || value === null) return;
        var values = Array.isArray(value) ? value : [value];
        values.forEach(function (item) {
            if (item !== null && typeof item === "object") {
                throw validationError("Query parameter " + key + " must contain primitive values");
            }
            endpoint.searchParams.append(key, String(item));
        });
    });
}

function buildHeaders(configHeaders, runtimeHeaders) {
    var headers = new Headers();
    [parseObject(configHeaders, "Headers"), parseObject(runtimeHeaders, "msg.ociHeaders")]
        .forEach(function (source) {
            Object.keys(source).forEach(function (key) {
                var lowerKey = key.toLowerCase();
                if (PROTECTED_HEADERS[lowerKey]) {
                    throw validationError("Protected header cannot be overridden: " + lowerKey);
                }
                var value = source[key];
                if (value !== null && typeof value === "object") {
                    throw validationError("Header " + key + " must have a primitive value");
                }
                if (value === undefined || value === null) {
                    headers.delete(key);
                } else {
                    headers.set(key, String(value));
                }
            });
        });
    return headers;
}

function serializeBody(method, payload, headers) {
    if (BODY_METHODS.indexOf(method) === -1 || payload === undefined) return undefined;
    if (Buffer.isBuffer(payload)) {
        throw validationError("Buffer request bodies are not supported; use a service-specific binary transfer node");
    }
    if (typeof payload === "string") {
        if (!headers.has("content-type")) headers.set("content-type", "text/plain; charset=utf-8");
        return payload;
    }
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    return JSON.stringify(payload);
}

function prepareRequest(options) {
    var method = normalizeMethod(options.method);
    var endpoint = appendPath(validateEndpoint(options.endpoint), options.path);
    appendQueryMap(endpoint, parseObject(options.query, "Query"));
    appendQueryMap(endpoint, parseObject(options.runtimeQuery, "msg.ociQuery"));
    var headers = buildHeaders(options.headers, options.runtimeHeaders);
    var timeoutMs = Number(options.timeoutMs || 30000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) {
        throw validationError("Timeout must be an integer from 1 to 300000 milliseconds");
    }
    var responseType = String(options.responseType || "auto").toLowerCase();
    if (["auto", "json", "text", "buffer"].indexOf(responseType) === -1) {
        throw validationError("Response type must be auto, json, text, or buffer");
    }
    return {
        request: {
            method: method,
            headers: headers,
            uri: endpoint.toString(),
            body: serializeBody(method, options.payload, headers)
        },
        method: method,
        timeoutMs: timeoutMs,
        responseType: responseType
    };
}

function headersToObject(headers) {
    var result = {};
    headers.forEach(function (value, key) {
        result[key] = value;
    });
    return result;
}

async function decodeResponse(response, responseType) {
    if (response.status === 204 || response.status === 205) return null;
    if (responseType === "buffer") {
        return Buffer.from(await response.arrayBuffer());
    }
    var text = await response.text();
    if (!text) return null;
    var contentType = response.headers.get("content-type") || "";
    var parseJson = responseType === "json" ||
        (responseType === "auto" && /(?:application|text)\/(?:[^;]+\+)?json\b/i.test(contentType));
    if (!parseJson) return text;
    try {
        return JSON.parse(text);
    } catch (err) {
        var parseError = new Error("OCI API response was not valid JSON");
        parseError.responseData = text;
        parseError.statusCode = response.status;
        throw parseError;
    }
}

function responseError(response, payload, responseHeaders) {
    var message = "OCI API request failed with HTTP " + response.status;
    var code = null;
    if (payload && typeof payload === "object" && !Buffer.isBuffer(payload)) {
        message = payload.message || payload.detail || message;
        code = payload.code || payload.serviceCode || null;
    } else if (typeof payload === "string" && payload.trim()) {
        message = payload.trim();
    }
    var err = new Error(message);
    err.statusCode = response.status;
    err.serviceCode = code;
    err.responseData = payload;
    err.opcRequestId = responseHeaders["opc-request-id"] || null;
    return err;
}

async function executeSignedRequest(provider, prepared) {
    var controller = new AbortController();
    var signer = new common.DefaultRequestSigner(provider);
    var client = new common.FetchHttpClient(signer, null, {
        redirect: "manual",
        signal: controller.signal
    });
    var timer = setTimeout(function () {
        controller.abort();
    }, prepared.timeoutMs);

    try {
        var response = await client.send(prepared.request);
        var responseHeaders = headersToObject(response.headers);
        var payload = await decodeResponse(response, prepared.responseType);
        if (!response.ok) throw responseError(response, payload, responseHeaders);
        return {
            payload: payload,
            statusCode: response.status,
            responseHeaders: responseHeaders,
            url: prepared.request.uri,
            method: prepared.method
        };
    } catch (err) {
        if (err && err.name === "AbortError") {
            var timeoutError = new Error("OCI API request timed out after " + prepared.timeoutMs + " ms");
            timeoutError.code = "ETIMEDOUT";
            throw timeoutError;
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    prepareRequest: prepareRequest,
    executeSignedRequest: executeSignedRequest
};

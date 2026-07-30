const { URL } = require("url")

const FUSION_REST_BASE_URL_FORMAT =
    "https://<fusion-host>/fscmRestApi/resources/<api-version>";

function ensureHttps(urlString) {
    const parsedUrl = new URL(urlString);
    if (parsedUrl.protocol !== "https:") {
        throw new Error("Only HTTPS URLs are allowed");
    }
    return parsedUrl;
}

// Restrict a user-supplied custom URL to the configured Fusion host so the SCM
// bearer token cannot be sent to an arbitrary host.
function ensureAllowedHost(urlString, allowedHostname) {
    const parsedUrl = ensureHttps(urlString);
    const allowed = String(allowedHostname || "").trim().toLowerCase();
    if (!allowed) {
        throw new Error("Cannot validate custom URL: no SCM server hostname is configured");
    }
    if (parsedUrl.hostname.toLowerCase() !== allowed) {
        throw new Error(
            "Custom URL host '" + parsedUrl.hostname + "' does not match the configured SCM host '" +
            allowed + "'. Custom requests may only target the configured Fusion host."
        );
    }
    return parsedUrl;
}

function ensureAllowedScmResourceUrl(urlString, allowedHostname, apiVersion) {
    var parsedUrl;
    var configuredBase;
    try {
        parsedUrl = ensureHttps(urlString);
        configuredBase = new URL(formatFusionRestBaseUrl(allowedHostname, apiVersion));
    } catch (err) {
        throw new Error("Custom URL must target the configured Fusion REST origin and API version");
    }

    var resourceRoot = configuredBase.pathname.replace(/\/$/, "");
    var isResourcePath = parsedUrl.pathname === resourceRoot ||
        parsedUrl.pathname.startsWith(resourceRoot + "/");
    if (
        parsedUrl.username ||
        parsedUrl.password ||
        parsedUrl.hash ||
        parsedUrl.origin !== configuredBase.origin ||
        !isResourcePath
    ) {
        throw new Error("Custom URL must target the configured Fusion REST origin and API version");
    }
    return parsedUrl;
}

function invalidFusionRestBaseUrl() {
    return new Error("Invalid Fusion REST Base URL. Expected: " + FUSION_REST_BASE_URL_FORMAT);
}

function parseFusionRestBaseUrl(urlString) {
    var parsed;
    try {
        parsed = new URL(String(urlString || "").trim());
    } catch (err) {
        throw invalidFusionRestBaseUrl();
    }

    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw invalidFusionRestBaseUrl();
    }

    var match = parsed.pathname.match(/^\/fscmRestApi\/resources\/([^/]+)\/?$/);
    if (!match) {
        throw invalidFusionRestBaseUrl();
    }

    var version;
    try {
        version = decodeURIComponent(match[1]);
    } catch (err) {
        throw invalidFusionRestBaseUrl();
    }
    if (!version || version.indexOf("/") !== -1) {
        throw invalidFusionRestBaseUrl();
    }

    return {
        hostname: parsed.host,
        version: version,
        baseUrl: "https://" + parsed.host + "/fscmRestApi/resources/" + encodeURIComponent(version)
    };
}

function formatFusionRestBaseUrl(hostname, version) {
    var host = String(hostname || "").trim();
    var apiVersion = String(version || "").trim();
    if (!host || !apiVersion || /[\/?#]/.test(host) || host.indexOf("://") !== -1) {
        throw invalidFusionRestBaseUrl();
    }
    return parseFusionRestBaseUrl(
        "https://" + host + "/fscmRestApi/resources/" + encodeURIComponent(apiVersion)
    ).baseUrl;
}

module.exports = {
    ensureHttps,
    ensureAllowedHost,
    ensureAllowedScmResourceUrl,
    parseFusionRestBaseUrl,
    formatFusionRestBaseUrl,
    FUSION_REST_BASE_URL_FORMAT
};

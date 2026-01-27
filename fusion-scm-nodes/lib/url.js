const { URL } = require("url")

function ensureHttps(urlString) {
    const parsedUrl = new URL(urlString);
    if (parsedUrl.protocol !== "https:") {
        throw new Error("Only HTTPS URLs are allowed");
    }
    return parsedUrl;
}

module.exports = { ensureHttps };
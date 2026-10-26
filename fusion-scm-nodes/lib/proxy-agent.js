var HttpsProxyAgent = require("https-proxy-agent").HttpsProxyAgent;
var tls = require("tls");

class FusionProxyAgent extends HttpsProxyAgent {
    constructor(proxyUrl, credentials) {
        var proxy;
        try { proxy = new URL(proxyUrl); }
        catch (err) { throw new Error("Proxy URL must be a valid HTTP(S) URL"); }
        if (proxy.protocol !== "http:" && proxy.protocol !== "https:") throw new Error("Proxy URL must use HTTP(S)");
        if (proxy.username || proxy.password) throw new Error("Move proxy authentication into the Proxy Username and Proxy Password credential fields");
        credentials = credentials || {};
        proxy.username = encodeURIComponent(credentials.proxyUsername || "");
        proxy.password = encodeURIComponent(credentials.proxyPassword || "");
        super(proxy);
    }

    connect(request, options) {
        if (!options.secureEndpoint) {
            return super.connect(request, options);
        }

        var destination = options.servername || options.host;
        var checkServerIdentity = options.checkServerIdentity || tls.checkServerIdentity;
        // The upstream tunnel strips host; without DNS SNI, TLS otherwise checks localhost.
        var tlsOptions = Object.assign({}, options, {
            checkServerIdentity: function (hostname, certificate) {
                return checkServerIdentity.call(this, destination, certificate);
            }
        });
        return super.connect(request, tlsOptions);
    }
}

module.exports = { HttpsProxyAgent: FusionProxyAgent };

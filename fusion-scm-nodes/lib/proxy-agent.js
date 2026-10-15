var HttpsProxyAgent = require("https-proxy-agent").HttpsProxyAgent;
var tls = require("tls");

class FusionProxyAgent extends HttpsProxyAgent {
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

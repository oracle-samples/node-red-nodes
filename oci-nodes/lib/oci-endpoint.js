var Realm = require("oci-common").Realm;

function matchesKnownRealm(hostname, pattern) {
    var match = pattern.exec(hostname);
    if (!match) return false;

    var domain = match[1].toLowerCase();
    return Realm.values().some(function (realm) {
        return realm.secondLevelDomain === domain;
    });
}

module.exports = {
    matchesKnownRealm: matchesKnownRealm
};

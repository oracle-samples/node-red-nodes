/*
 Copyright (c) 2026 Oracle and/or its affiliates.
 Licensed under the Universal Permissive License (UPL), Version 1.0.
*/

function resolve(configured, msg, legacyMessageFirst) {
    if (Object.prototype.hasOwnProperty.call(msg, "digitalTwinInstanceOcid")) {
        if (typeof msg.digitalTwinInstanceOcid !== "string" || !msg.digitalTwinInstanceOcid.trim()) {
            var err = new Error("msg.digitalTwinInstanceOcid must be a nonempty Digital Twin Instance OCID");
            err.code = "OCI_INPUT_INVALID";
            throw err;
        }
        return msg.digitalTwinInstanceOcid.trim();
    }
    if (legacyMessageFirst) {
        return String(msg.digitalTwinOcid !== undefined && msg.digitalTwinOcid !== null
            ? msg.digitalTwinOcid : configured || "").trim();
    }
    return configured || msg.digitalTwinOcid;
}

module.exports = { resolve: resolve };

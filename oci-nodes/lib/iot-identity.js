/*
 Copyright (c) 2026 Oracle and/or its affiliates.
 Licensed under the Universal Permissive License (UPL), Version 1.0.
*/

function resolve(configured, msg, legacyMessageFirst) {
    if (Object.prototype.hasOwnProperty.call(msg, "digitalTwinInstanceId")) {
        if (typeof msg.digitalTwinInstanceId !== "string" || !msg.digitalTwinInstanceId.trim()) {
            var err = new Error("msg.digitalTwinInstanceId must be a nonempty digital twin instance identifier");
            err.code = "OCI_INPUT_INVALID";
            throw err;
        }
        return msg.digitalTwinInstanceId.trim();
    }
    if (legacyMessageFirst) {
        return String(msg.digitalTwinOcid !== undefined && msg.digitalTwinOcid !== null
            ? msg.digitalTwinOcid : configured || "").trim();
    }
    return configured || msg.digitalTwinOcid;
}

module.exports = { resolve: resolve };

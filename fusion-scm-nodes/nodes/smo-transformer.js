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
  var DEFAULT_MAX_COMPOSITE_ENTRIES = 1000;
  var DEFAULT_MAX_COMPOSITE_AGE_SEC = 3600;

  function SmoTransformerNode(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    node.eventTypeCode = config.eventTypeCode || "";
    node.entityCodeFields = parseJsonSafe(config.entityCodeFields, ["deviceId", "machineId"]);
    node.fieldMappings = parseJsonSafe(config.fieldMappings, []);
    node.enableNesting = config.enableNesting || false;
    node.nestingKey = config.nestingKey || "";
    node.enableComposite = config.enableComposite || false;
    node.requiredFields = parseJsonSafe(config.requiredFields, []);
    node.splitFields = parseJsonSafe(config.splitFields, []);
    node.customJsonata = config.customJsonata || "";
    node.staleTimeout = parseInt(config.staleTimeout, 10) || 0;
    node.maxCompositeEntries = Math.max(1, parseInt(config.maxCompositeEntries, 10) || DEFAULT_MAX_COMPOSITE_ENTRIES);
    node.maxCompositeAgeSec = Math.max(1, parseInt(config.maxCompositeAgeSec, 10) || DEFAULT_MAX_COMPOSITE_AGE_SEC);

    var compositeStore = {};
    var staleTimers = {};

    node.on("input", function (msg, send, done) {
      try {
        var payload = msg.payload;
        if (!payload || typeof payload !== "object") {
          node.warn("Invalid payload: expected an object");
          done();
          return;
        }

        // Custom JSONata override
        if (node.customJsonata && node.customJsonata.trim() !== "") {
          var expr;
          try {
            expr = RED.util.prepareJSONataExpression(node.customJsonata, node);
          } catch (prepErr) {
            node.error("JSONata preparation error: " + prepErr.message, msg);
            done(prepErr);
            return;
          }
          RED.util.evaluateJSONataExpression(expr, msg, function (err, result) {
            if (err) {
              node.error("JSONata evaluation error: " + err.message, msg);
              done(err);
              return;
            }
            msg.payload = result;
            send(msg);
            done();
          });
          return;
        }

        var entityCode = resolveEntityCode(payload, node.entityCodeFields);
        var eventTime = payload.eventTime || null;
        payload = applySplitFields(payload, node.splitFields);
        var data = applyFieldMappings(payload, node.fieldMappings);

        if (node.enableNesting && node.nestingKey) {
          var wrapped = {};
          wrapped[node.nestingKey] = data;
          data = wrapped;
        }

        var outputPayload = {
          entityCode: entityCode,
          eventTypeCode: node.eventTypeCode,
          eventTime: eventTime,
          data: data
        };

        if (node.enableComposite) {
          handleComposite(node, msg, outputPayload, compositeStore, staleTimers, send, done);
        } else {
          msg.payload = outputPayload;
          send(msg);
          done();
        }
      } catch (e) {
        node.error("Transform error: " + e.message, msg);
        done(e);
      }
    });

    node.on("close", function () {
      for (var key in staleTimers) { if (staleTimers[key]) clearTimeout(staleTimers[key]); }
      compositeStore = {};
      staleTimers = {};
    });
  }

  // =========================================================================
  // HELPER FUNCTIONS
  // =========================================================================

  function parseJsonSafe(str, defaultVal) {
    if (Array.isArray(str) || (typeof str === "object" && str !== null)) return str;
    if (typeof str === "string" && str.trim() !== "") {
      try { return JSON.parse(str); } catch (e) { return defaultVal; }
    }
    return defaultVal;
  }

  function resolveEntityCode(payload, entityCodeFields) {
    for (var i = 0; i < entityCodeFields.length; i++) {
      if (payload[entityCodeFields[i]] != null) return payload[entityCodeFields[i]];
    }
    return null;
  }

  function applySplitFields(payload, splitFields) {
    for (var i = 0; i < splitFields.length; i++) {
      var sf = splitFields[i];
      var value = payload[sf.incomingField];
      if (value != null && typeof value === "string") {
        var parts = value.split(sf.delimiter);
        if (parts.length >= 2) {
          payload[sf.outputField1] = parts[0];
          var secondPart = parts.slice(1).join(sf.delimiter);
          var asNumber = Number(secondPart);
          payload[sf.outputField2] = isNaN(asNumber) ? secondPart : asNumber;
        }
      }
    }
    return payload;
  }

  /**
   * Apply field mappings and value transformations.
   *
   * Transform types:
   *   none         - pass through as-is
   *   string       - String(value)
   *   number       - Number(value)
   *   staticValue  - writes defaultValue as a constant (no incoming field needed)
   *   valueMap     - lookup table; __present__ key maps on field existence
   *   nestedObject - pass through an entire object
   *   collectFlat  - gather named flat fields into one nested object
   *   dynamicSift  - copy all payload fields except an exclude list
   */
  function applyFieldMappings(payload, fieldMappings) {
    var data = {};

    for (var i = 0; i < fieldMappings.length; i++) {
      var mapping = fieldMappings[i];
      var incomingField = mapping.incomingField;
      var smoField = mapping.smoField;
      var transformType = mapping.transformType || "none";

      // First match wins
      if (data[smoField] !== undefined) continue;

      // staticValue: write a constant — no incoming field required
      if (transformType === "staticValue") {
        if (mapping.defaultValue !== undefined && mapping.defaultValue !== "") {
          data[smoField] = mapping.defaultValue;
        }
        continue;
      }

      // collectFlat: gather multiple named fields — incomingField is optional
      if (transformType === "collectFlat") {
        var collectFields = mapping.collectFields || [];
        var collected = {};
        for (var k = 0; k < collectFields.length; k++) {
          var fieldName = collectFields[k];
          if (payload[fieldName] !== undefined) {
            collected[fieldName] = payload[fieldName];
          }
        }
        if (Object.keys(collected).length > 0) {
          data[smoField] = collected;
        }
        continue;
      }

      // All other transforms require an incoming field value
      var value = payload[incomingField];
      var hasValue = (value !== undefined);

      if (!hasValue) {
        if (mapping.defaultValue !== undefined && mapping.defaultValue !== "") {
          data[smoField] = mapping.defaultValue;
        }
        continue;
      }

      switch (transformType) {
        case "none":
          data[smoField] = value;
          break;
        case "string":
          data[smoField] = String(value);
          break;
        case "number":
          data[smoField] = Number(value);
          break;
        case "valueMap":
          var valueMap = mapping.valueMap || {};
          if (valueMap["__present__"] !== undefined) {
            data[smoField] = valueMap["__present__"];
          } else {
            var sv = String(value);
            data[smoField] = valueMap[sv] !== undefined ? valueMap[sv] : value;
          }
          break;
        case "nestedObject":
          data[smoField] = value;
          break;
        case "dynamicSift":
          var excludeFields = mapping.excludeFields || [];
          var sifted = {};
          var keys = Object.keys(payload);
          for (var j = 0; j < keys.length; j++) {
            if (excludeFields.indexOf(keys[j]) === -1) sifted[keys[j]] = payload[keys[j]];
          }
          data[smoField] = sifted;
          break;
        default:
          data[smoField] = value;
      }
    }
    return data;
  }

  function mergeData(a, b) {
    var result = Object.assign({}, a);
    var keys = Object.keys(b);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (result[k] != null && typeof result[k] === "object" && !Array.isArray(result[k]) &&
          typeof b[k] === "object" && !Array.isArray(b[k])) {
        result[k] = Object.assign({}, result[k], b[k]);
      } else {
        result[k] = b[k];
      }
    }
    return result;
  }

  function isCompositeComplete(outputPayload, requiredFields) {
    for (var i = 0; i < requiredFields.length; i++) {
      if (outputPayload.data[requiredFields[i]] == null) return false;
    }
    return true;
  }

  function buildCompositeKey(outputPayload, eventTypeCode) {
    if (outputPayload.entityCode == null || outputPayload.eventTime == null) return null;
    return outputPayload.entityCode + "_" + outputPayload.eventTime + "_" + eventTypeCode;
  }

  function clearCompositeTimer(staleTimers, key) {
    if (staleTimers[key]) {
      clearTimeout(staleTimers[key]);
      delete staleTimers[key];
    }
  }

  function flushCompositeEntry(node, compositeStore, staleTimers, key, reason, send) {
    var entry = compositeStore[key];
    if (!entry) return;
    delete compositeStore[key];
    clearCompositeTimer(staleTimers, key);
    node.warn("Composite message flushed (" + reason + "): " + key);
    var outMsg = RED.util.cloneMessage(entry.msg || {});
    outMsg.payload = entry.payload;
    (send || node.send.bind(node))(outMsg);
  }

  function enforceCompositeLimits(node, compositeStore, staleTimers, send) {
    var keys = Object.keys(compositeStore);
    if (keys.length === 0) return;

    var now = Date.now();
    var maxAgeMs = node.maxCompositeAgeSec * 1000;
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var entry = compositeStore[key];
      if (!entry) continue;
      if (maxAgeMs > 0 && now - (entry.createdAt || now) > maxAgeMs) {
        flushCompositeEntry(node, compositeStore, staleTimers, key, "max pending age exceeded", send);
      }
    }

    keys = Object.keys(compositeStore);
    if (keys.length <= node.maxCompositeEntries) return;
    keys.sort(function (a, b) {
      var aTs = (compositeStore[a] && compositeStore[a].createdAt) || 0;
      var bTs = (compositeStore[b] && compositeStore[b].createdAt) || 0;
      return aTs - bTs;
    });
    while (Object.keys(compositeStore).length > node.maxCompositeEntries && keys.length > 0) {
      flushCompositeEntry(node, compositeStore, staleTimers, keys.shift(), "max pending entries exceeded", send);
    }
  }

  function scheduleStaleTimer(node, compositeStore, staleTimers, key, send) {
    clearCompositeTimer(staleTimers, key);
    if (node.staleTimeout <= 0) return;
    staleTimers[key] = setTimeout(function () {
      flushCompositeEntry(node, compositeStore, staleTimers, key, "stale timeout", send);
      if (Object.keys(compositeStore).length === 0) node.status({});
    }, node.staleTimeout * 1000);
  }

  function handleComposite(node, msg, outputPayload, compositeStore, staleTimers, send, done) {
    var requiredFields = node.requiredFields || [];
    if (isCompositeComplete(outputPayload, requiredFields)) {
      msg.payload = outputPayload;
      node.status({});
      send(msg);
      done();
      return;
    }

    var key = buildCompositeKey(outputPayload, node.eventTypeCode);
    if (!key) {
      var keyErr = new Error("Composite mode requires both entityCode and eventTime for incomplete messages");
      node.status({ fill: "red", shape: "ring", text: "missing composite key fields" });
      node.error(keyErr.message, msg);
      done(keyErr);
      return;
    }

    enforceCompositeLimits(node, compositeStore, staleTimers, send);

    var now = Date.now();
    var existing = compositeStore[key];
    if (!existing) {
      compositeStore[key] = {
        payload: outputPayload,
        msg: RED.util.cloneMessage(msg),
        createdAt: now,
        updatedAt: now
      };
      node.status({ fill: "yellow", shape: "ring", text: "waiting: " + key });
      scheduleStaleTimer(node, compositeStore, staleTimers, key, send);
      enforceCompositeLimits(node, compositeStore, staleTimers, send);
      done();
      return;
    }

    clearCompositeTimer(staleTimers, key);

    var merged = Object.assign({}, existing.payload, outputPayload);
    merged.data = mergeData((existing.payload && existing.payload.data) || {}, outputPayload.data || {});
    if (isCompositeComplete(merged, requiredFields)) {
      delete compositeStore[key];
      node.status({});
      msg.payload = merged;
      send(msg);
      done();
      return;
    }

    existing.payload = merged;
    existing.msg = RED.util.cloneMessage(msg);
    existing.updatedAt = now;
    compositeStore[key] = existing;
    node.status({ fill: "yellow", shape: "ring", text: "waiting: " + key });
    scheduleStaleTimer(node, compositeStore, staleTimers, key, send);
    enforceCompositeLimits(node, compositeStore, staleTimers, send);
    done();
  }

  RED.nodes.registerType("smo-transformer", SmoTransformerNode);
};

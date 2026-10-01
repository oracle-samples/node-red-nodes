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
    node.eventTimeFields = parseJsonSafe(config.eventTimeFields, ["eventTime"]);
    node.defaultEventTime = isEnabled(config.defaultEventTime);
    node.outputTarget = config.outputTarget || "smoEvent";
    node.enableNesting = config.enableNesting || false;
    node.nestingKey = config.nestingKey || "";
    node.enableComposite = config.enableComposite || false;
    node.requiredFields = parseJsonSafe(config.requiredFields, []);
    node.splitFields = parseJsonSafe(config.splitFields, []);
    node.customJsonata = config.customJsonata || "";
    node.jsonataExpr = null;
    node.jsonataError = null;
    if (node.customJsonata && node.customJsonata.trim() !== "") {
      try {
        node.jsonataExpr = RED.util.prepareJSONataExpression(node.customJsonata, node);
      } catch (prepErr) {
        node.jsonataError = prepErr;
      }
    }
    node.staleTimeout = parseInt(config.staleTimeout, 10) || 0;
    node.maxCompositeEntries = Math.max(1, parseInt(config.maxCompositeEntries, 10) || DEFAULT_MAX_COMPOSITE_ENTRIES);
    node.maxCompositeAgeSec = Math.max(1, parseInt(config.maxCompositeAgeSec, 10) || DEFAULT_MAX_COMPOSITE_AGE_SEC);

    var compositeStore = {};
    var staleTimers = {};
    var statusState = { generation: 0 };
    var compositeState = { closed: false, queues: new Map(), pendingInputs: 0 };

    node.on("input", function (msg, send, done) {
      try {
        var payload = msg.payload;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          var payloadErr = new Error("Invalid payload: expected an object");
          setTransformerStatus(node, statusState, { fill: "red", shape: "ring", text: "invalid payload" });
          payloadErr.code = payloadErr.code ? String(payloadErr.code) : null;
          msg.error = { message: payloadErr.message, code: payloadErr.code };
          done(payloadErr);
          return;
        }

        // Custom JSONata override (expression compiled once at construction)
        if (node.customJsonata && node.customJsonata.trim() !== "") {
          if (node.jsonataError) {
            reportTransformError(
              node,
              statusState,
              msg,
              node.jsonataError,
              done,
              { fill: "red", shape: "dot", text: "transform failed" }
            );
            return;
          }
          RED.util.evaluateJSONataExpression(node.jsonataExpr, msg, function (err, result) {
            if (err) {
              reportTransformError(
                node,
                statusState,
                msg,
                err,
                done,
                { fill: "red", shape: "dot", text: "transform failed" }
              );
              return;
            }
            try {
              sendOutputMessage(msg, result, node.outputTarget, send);
              setTransformerStatus(node, statusState, { fill: "green", shape: "dot", text: "transformed" });
            } catch (callbackErr) {
              reportTransformError(
                node,
                statusState,
                msg,
                callbackErr,
                done,
                { fill: "red", shape: "dot", text: "transform failed" }
              );
              return;
            }
            done();
          });
          return;
        }

        if (!node.eventTypeCode) {
          var eventTypeErr = new Error("Event Type is required");
          setTransformerStatus(node, statusState, { fill: "red", shape: "ring", text: "no event type" });
          eventTypeErr.code = eventTypeErr.code ? String(eventTypeErr.code) : null;
          msg.error = { message: eventTypeErr.message, code: eventTypeErr.code };
          done(eventTypeErr);
          return;
        }

        var entityCode = resolveEntityCode(payload, node.entityCodeFields);
        var eventTime = resolveEventTime(payload, node.eventTimeFields, node.defaultEventTime);
        payload = applySplitFields(payload, node.splitFields);
        var data = applyFieldMappings(payload, node.fieldMappings);

        if (node.enableNesting && node.nestingKey) {
          var wrapped = {};
          setOwnField(wrapped, node.nestingKey, data);
          data = wrapped;
        }

        var outputPayload = {
          entityCode: entityCode,
          eventTypeCode: node.eventTypeCode,
          eventTime: eventTime,
          data: data
        };

        if (node.enableComposite) {
          queueComposite(compositeState, buildCompositeKey(outputPayload, node.eventTypeCode) || msg, function () {
            if (compositeState.closed) { done(); return; }
            return handleComposite(node, statusState, msg, outputPayload, compositeStore, staleTimers, compositeState, send, done);
          }, node.maxCompositeEntries).catch(function (err) {
            reportTransformError(node, statusState, msg, err, done,
              err.code === "SMO_COMPOSITE_BUSY" ? { fill: "red", shape: "ring", text: "composite busy" } :
                { fill: "red", shape: "dot", text: "transform failed" });
          });
        } else {
          sendOutputMessage(msg, outputPayload, node.outputTarget, send);
          setTransformerStatus(node, statusState, { fill: "green", shape: "dot", text: "transformed" });
          done();
        }
      } catch (e) {
        reportTransformError(
          node,
          statusState,
          msg,
          e,
          done,
          { fill: "red", shape: "dot", text: "transform failed" }
        );
      }
    });

    node.on("close", function (removed, done) {
      compositeState.closed = true;
      for (var key in staleTimers) { if (staleTimers[key]) clearTimeout(staleTimers[key]); }
      compositeStore = {};
      staleTimers = {};
      Promise.all(Array.from(compositeState.queues.values())).then(function () { done(); });
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

  function isEnabled(value) {
    return value === true || value === "true";
  }

  function setTransformerStatus(node, statusState, status) {
    statusState.generation += 1;
    node.status(status);
    return statusState.generation;
  }

  function reportTransformError(node, statusState, msg, err, done, status) {
    var message = err && err.message ? err.message : String(err);
    var errorCode = err && (err.errorNum || err.statusCode || err.code);
    var doneErr = err instanceof Error ? err : new Error(message);
    msg.error = {
      message: message,
      code: errorCode ? String(errorCode) : null
    };
    setTransformerStatus(node, statusState, status);
    doneErr.code = msg.error.code;
    done(doneErr);
  }

  function hasOwnField(source, key) {
    return Object.prototype.hasOwnProperty.call(source, key);
  }

  function setOwnField(target, key, value) {
    Object.defineProperty(target, key, { value: value, enumerable: true, writable: true, configurable: true });
  }

  function assignOwnFields(target, source) {
    if (source == null) return target;
    Object.keys(source).forEach(function (key) { setOwnField(target, key, source[key]); });
    return target;
  }

  function getByPath(source, path) {
    if (!source || path === undefined || path === null || path === "") return undefined;
    if (Object.prototype.hasOwnProperty.call(source, path)) return source[path];
    var parts = String(path).split(".");
    var value = source;
    for (var i = 0; i < parts.length; i++) {
      if (value === undefined || value === null || !hasOwnField(value, parts[i])) return undefined;
      value = value[parts[i]];
    }
    return value;
  }

  function resolveEntityCode(payload, entityCodeFields) {
    for (var i = 0; i < entityCodeFields.length; i++) {
      var value = getByPath(payload, entityCodeFields[i]);
      if (value != null) return value;
    }
    return null;
  }

  function resolveEventTime(payload, eventTimeFields, defaultEventTime) {
    for (var i = 0; i < eventTimeFields.length; i++) {
      var value = getByPath(payload, eventTimeFields[i]);
      if (value != null && value !== "") return value;
    }
    return defaultEventTime ? new Date().toISOString() : null;
  }

  function applySplitFields(payload, splitFields) {
    var output = assignOwnFields({}, payload);
    for (var i = 0; i < splitFields.length; i++) {
      var sf = splitFields[i];
      var value = getByPath(payload, sf.incomingField);
      if (value != null && typeof value === "string") {
        var parts = value.split(sf.delimiter);
        if (parts.length >= 2) {
          setOwnField(output, sf.outputField1, parts[0]);
          var secondPart = parts.slice(1).join(sf.delimiter);
          var asNumber = Number(secondPart);
          setOwnField(output, sf.outputField2, isNaN(asNumber) ? secondPart : asNumber);
        }
      }
    }
    return output;
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
      if (hasOwnField(data, smoField) && data[smoField] !== undefined) continue;

      // staticValue: write a constant — no incoming field required
      if (transformType === "staticValue") {
        if (mapping.defaultValue !== undefined && mapping.defaultValue !== "") {
          setOwnField(data, smoField, mapping.defaultValue);
        }
        continue;
      }

      // collectFlat: gather multiple named fields — incomingField is optional
      if (transformType === "collectFlat") {
        var collectFields = mapping.collectFields || [];
        var collected = {};
        for (var k = 0; k < collectFields.length; k++) {
          var fieldName = collectFields[k];
          var collectedValue = getByPath(payload, fieldName);
          if (collectedValue !== undefined) {
            setOwnField(collected, fieldName, collectedValue);
          }
        }
        if (Object.keys(collected).length > 0) {
          setOwnField(data, smoField, collected);
        }
        continue;
      }

      // All other transforms require an incoming field value
      var value = getByPath(payload, incomingField);
      var hasValue = (value !== undefined);

      if (!hasValue) {
        if (mapping.defaultValue !== undefined && mapping.defaultValue !== "") {
          setOwnField(data, smoField, mapping.defaultValue);
        }
        continue;
      }

      switch (transformType) {
        case "none":
          setOwnField(data, smoField, value);
          break;
        case "string":
          setOwnField(data, smoField, String(value));
          break;
        case "number":
          setOwnField(data, smoField, Number(value));
          break;
        case "valueMap":
          var valueMap = mapping.valueMap || {};
          if (hasOwnField(valueMap, "__present__") && valueMap["__present__"] !== undefined) {
            setOwnField(data, smoField, valueMap["__present__"]);
          } else {
            var sv = String(value);
            setOwnField(data, smoField, hasOwnField(valueMap, sv) && valueMap[sv] !== undefined ? valueMap[sv] : value);
          }
          break;
        case "nestedObject":
          setOwnField(data, smoField, value);
          break;
        case "dynamicSift":
          var excludeFields = mapping.excludeFields || [];
          var sifted = {};
          var keys = Object.keys(payload);
          for (var j = 0; j < keys.length; j++) {
            if (excludeFields.indexOf(keys[j]) === -1) setOwnField(sifted, keys[j], payload[keys[j]]);
          }
          setOwnField(data, smoField, sifted);
          break;
        default:
          setOwnField(data, smoField, value);
      }
    }
    return data;
  }

  function mergeData(a, b) {
    var result = assignOwnFields({}, a);
    var keys = Object.keys(b);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (hasOwnField(result, k) && result[k] != null && typeof result[k] === "object" && !Array.isArray(result[k]) &&
          typeof b[k] === "object" && !Array.isArray(b[k])) {
        setOwnField(result, k, assignOwnFields(assignOwnFields({}, result[k]), b[k]));
      } else {
        setOwnField(result, k, b[k]);
      }
    }
    return result;
  }

  function isCompositeComplete(outputPayload, requiredFields) {
    for (var i = 0; i < requiredFields.length; i++) {
      if (!hasOwnField(outputPayload.data, requiredFields[i]) || outputPayload.data[requiredFields[i]] == null) return false;
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

  function queueComposite(state, key, action, inputLimit) {
    if (inputLimit && state.pendingInputs >= inputLimit) {
      var busy = new Error("Composite input capacity reached; no transaction work was started for this message");
      busy.code = "SMO_COMPOSITE_BUSY";
      return Promise.reject(busy);
    }
    if (inputLimit) state.pendingInputs += 1;
    var previous = state.queues.get(key) || Promise.resolve();
    var pending = previous.then(action);
    var settled = pending.then(release, release);
    state.queues.set(key, settled);
    function release() {
      if (inputLimit) state.pendingInputs -= 1;
      if (state.queues.get(key) === settled) state.queues.delete(key);
    }
    return pending;
  }

  function transactionBridge() {
    var bridge = RED.nodes.getNode && RED.nodes.getNode[Symbol.for("oracle.node-red.db.transactions.v1")];
    return bridge && bridge.version === 1 && typeof bridge.capture === "function" &&
      typeof bridge.finalize === "function" ? bridge : null;
  }

  function captureCompositeOwner(msg) {
    var bridge = transactionBridge();
    if (!bridge && !Object.prototype.hasOwnProperty.call(msg, "_dbTransaction") && !msg.transaction) return null;
    try {
      if (bridge) return bridge.capture(msg);
    } catch (err) {
      // Registry diagnostics can originate in DB cleanup; expose only the ownership boundary here.
    }
    var invalid = new Error("Composite transaction reference is unavailable, invalid, or no longer active");
    invalid.code = "SMO_COMPOSITE_TRANSACTION_INVALID";
    throw invalid;
  }

  function transactionResults(msg) {
    if (!Array.isArray(msg.smoTransactionResults)) return [];
    return msg.smoTransactionResults.map(function (result) {
      return {
        outcome: result.outcome,
        closed: result.closed === true,
        failed: result.failed === true
      };
    });
  }

  function mergeTransactionResults(previous, current) {
    return transactionResults(previous).concat(transactionResults(current));
  }

  function addTransactionResults(combined, previous, current, owners, results) {
    var history = mergeTransactionResults(previous, current);
    var unique = [];
    owners.forEach(function (owner) { if (owner && unique.indexOf(owner) === -1) unique.push(owner); });
    unique.forEach(function (owner, index) {
      var result = results[index] || { outcome: "unknown", closed: false, failed: true };
      history.push({ outcome: result.outcome, closed: result.closed, failed: result.failed });
    });
    if (history.length) combined.smoTransactionResults = history;
    return combined;
  }

  function recordUnknownTransaction(msg) {
    var history = transactionResults(msg);
    history.push({ outcome: "unknown", closed: false, failed: true });
    msg.smoTransactionResults = history;
  }

  function clearTransactionReference(msg) {
    delete msg._dbTransaction;
    delete msg.transaction;
  }

  function copyCompositeFailure(msg, combined) {
    if (Object.prototype.hasOwnProperty.call(combined, "smoTransactionResults")) {
      msg.smoTransactionResults = combined.smoTransactionResults;
    } else {
      delete msg.smoTransactionResults;
    }
  }

  function flushCompositeEntry(node, statusState, compositeStore, staleTimers, key, reason, send, state) {
    var entry = compositeStore[key];
    if (!entry || state.closed) return;
    delete compositeStore[key];
    clearCompositeTimer(staleTimers, key);
    try {
      captureCompositeOwner(entry.msg);
    } catch (err) {
      recordUnknownTransaction(entry.msg);
      reportTransformError(node, statusState, entry.msg, err, function (reported) { node.error(reported, entry.msg); },
        { fill: "red", shape: "ring", text: "invalid transaction" });
      return false;
    }
    node.warn("Composite message flushed (" + reason + "): " + key);
    var outMsg = createOutputMessage(entry.msg || {}, entry.payload, node.outputTarget, entry.transaction);
    (send || node.send.bind(node))(outMsg);
    return true;
  }

  function enforceCompositeLimits(node, statusState, compositeStore, staleTimers, send, state) {
    var keys = Object.keys(compositeStore);
    if (keys.length === 0) return;

    var now = Date.now();
    var maxAgeMs = node.maxCompositeAgeSec * 1000;
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var entry = compositeStore[key];
      if (!entry) continue;
      if (maxAgeMs > 0 && now - entry.createdAt >= maxAgeMs) {
        flushCompositeEntry(node, statusState, compositeStore, staleTimers, key, "max pending age exceeded", send, state);
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
      flushCompositeEntry(node, statusState, compositeStore, staleTimers, keys.shift(), "max pending entries exceeded", send, state);
    }
  }

  function scheduleStaleTimer(node, statusState, compositeStore, staleTimers, key, send, waitingGeneration, state) {
    clearCompositeTimer(staleTimers, key);
    // Fragments reset inactivity, but cannot extend the original creation deadline.
    // Keep an age timer even without a stale timeout so idle partials still flush.
    var scheduledEntry = compositeStore[key];
    var remainingAgeMs = Math.max(0, scheduledEntry.createdAt + node.maxCompositeAgeSec * 1000 - Date.now());
    var staleMs = node.staleTimeout * 1000;
    var useStaleTimeout = staleMs > 0 && staleMs <= remainingAgeMs;
    var timeoutMs = useStaleTimeout ? staleMs : remainingAgeMs;
    var reason = useStaleTimeout ? "stale timeout" : "max pending age exceeded";
    staleTimers[key] = setTimeout(function () {
      queueComposite(state, key, function () {
        if (compositeStore[key] !== scheduledEntry || state.closed) return;
        var flushed = flushCompositeEntry(node, statusState, compositeStore, staleTimers, key, reason, send, state);
        if (flushed && Object.keys(compositeStore).length === 0 && statusState.generation === waitingGeneration) {
          setTransformerStatus(node, statusState, {});
        }
      }).catch(function (err) {
        reportTransformError(node, statusState, scheduledEntry.msg, err, function (reported) { node.error(reported, scheduledEntry.msg); },
          { fill: "red", shape: "dot", text: "transform failed" });
      });
    }, timeoutMs);
  }

  async function handleComposite(node, statusState, msg, outputPayload, compositeStore, staleTimers, state, send, done) {
    var requiredFields = node.requiredFields || [];
    var key = buildCompositeKey(outputPayload, node.eventTypeCode);
    var owner;
    try {
      owner = captureCompositeOwner(msg);
    } catch (err) {
      reportTransformError(node, statusState, msg, err, done,
        { fill: "red", shape: "ring", text: "invalid transaction" });
      return;
    }
    var pending = key && compositeStore[key];
    var combinedMsg = pending ? mergeCompositeMetadata(pending.msg, msg) : msg;
    if (pending) {
      var pendingOwner;
      try {
        pendingOwner = captureCompositeOwner(pending.msg);
      } catch (err) {
        delete compositeStore[key];
        clearCompositeTimer(staleTimers, key);
        recordUnknownTransaction(combinedMsg);
        copyCompositeFailure(msg, combinedMsg);
        reportTransformError(node, statusState, msg, err, done,
          { fill: "red", shape: "ring", text: "invalid transaction" });
        return;
      }
      if (pendingOwner !== owner) {
        // Consume the buffered entry before awaiting commits so failure cannot replay it through a timer.
        delete compositeStore[key];
        clearCompositeTimer(staleTimers, key);
        var owners = [pendingOwner, owner];
        var results;
        try {
          results = await transactionBridge().finalize(owners.filter(function (value) { return value !== null; }));
        } catch (err) {
          results = [];
        }
        combinedMsg = Object.assign({}, combinedMsg);
        addTransactionResults(combinedMsg, pending.msg, msg, owners, results);
        clearTransactionReference(combinedMsg);
        if (results.length !== owners.filter(function (value) { return value !== null; }).length || results.some(function (result) {
          return result.failed || result.outcome !== "committed" || !result.closed;
        })) {
          copyCompositeFailure(msg, combinedMsg);
          clearTransactionReference(msg);
          var commitErr = new Error("Composite transaction finalization failed; inspect smoTransactionResults before recovery");
          commitErr.code = "SMO_COMPOSITE_COMMIT_FAILED";
          reportTransformError(node, statusState, msg, commitErr, done,
            { fill: "red", shape: "dot", text: "commit failed" });
          return;
        }
        if (state.closed) { done(); return; }
      }
    }
    if (isCompositeComplete(outputPayload, requiredFields)) {
      if (key) {
        delete compositeStore[key];
        clearCompositeTimer(staleTimers, key);
      }
      sendOutputMessage(combinedMsg, outputPayload, node.outputTarget, send);
      setTransformerStatus(node, statusState, { fill: "green", shape: "dot", text: "transformed" });
      done();
      return;
    }

    if (!key) {
      var keyErr = new Error("Composite mode requires both entityCode and eventTime for incomplete messages");
      reportTransformError(node, statusState, msg, keyErr, done,
        { fill: "red", shape: "ring", text: "missing composite key fields" });
      return;
    }

    var now = Date.now();
    var merged = outputPayload;
    if (pending) {
      merged = Object.assign({}, pending.payload, outputPayload);
      merged.data = mergeData((pending.payload && pending.payload.data) || {}, outputPayload.data || {});
    }
    if (isCompositeComplete(merged, requiredFields)) {
      delete compositeStore[key];
      clearCompositeTimer(staleTimers, key);
      sendOutputMessage(combinedMsg, merged, node.outputTarget, send);
      setTransformerStatus(node, statusState, { fill: "green", shape: "dot", text: "transformed" });
      done();
      return;
    }

    compositeStore[key] = {
      payload: merged,
      msg: RED.util.cloneMessage(combinedMsg),
      transaction: combinedMsg.transaction,
      createdAt: pending ? pending.createdAt : now,
      updatedAt: now
    };
    var waitingGeneration = setTransformerStatus(node, statusState,
      { fill: "yellow", shape: "ring", text: "waiting: " + key });
    scheduleStaleTimer(node, statusState, compositeStore, staleTimers, key, send, waitingGeneration, state);
    enforceCompositeLimits(node, statusState, compositeStore, staleTimers, send, state);
    done();
  }

  function sendOutputMessage(msg, outputPayload, outputTarget, send) {
    send(createOutputMessage(msg, outputPayload, outputTarget, msg.transaction));
  }

  function mergeCompositeMetadata(previous, current) {
    var results = mergeTransactionResults(previous, current);
    if (!results.length) return current;
    var combined = Object.assign({}, current, { smoTransactionResults: results });
    if (current.transaction) {
      Object.defineProperty(combined, "transaction", {
        value: current.transaction, enumerable: false, writable: true, configurable: true
      });
    }
    return combined;
  }

  function createOutputMessage(msg, outputPayload, outputTarget, transaction) {
    var target = outputTarget === "payload" ? "payload" : "smoEvent";
    var outMsg = Object.assign({}, msg);
    outMsg[target] = outputPayload;
    if (transaction) {
      Object.defineProperty(outMsg, "transaction", {
        value: transaction,
        enumerable: false,
        writable: true,
        configurable: true
      });
    }
    return outMsg;
  }

  RED.nodes.registerType("smo-transformer", SmoTransformerNode);
};

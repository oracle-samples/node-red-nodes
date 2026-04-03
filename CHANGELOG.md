# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.2] - 2026-04-03

### Added
- `db-connection` Driver Mode toggle (Thick / Thin), Wallet Path, Proxy User, and two new auth types: DB Token — Resource Principal and DB Token — Session Token.
- `db-connection` inline help text for all auth types, connection options, and Test Connection behaviour.
- `sql` row-based Binds Mapping editor with source types (static, number, boolean, date, msg property, JSONata) and runtime `msg.binds` support.
- `dequeue` Continuous mode — auto-starts on deploy, long-polls with no input trigger, immediate auto-commit. Transactional mode (default) is unchanged.
- `enqueue` Delivery Mode (Persistent / Buffered), Payload Type (JSON / RAW / ADT), single-object auto-wrap, and optional output port.
- `dequeue` Payload Type (JSON / RAW / ADT) with automatic ADT-to-plain-object conversion.

### Changed
- `iot-config` is now connection-only. Topic and QoS moved to individual node editors, following the `mqtt-broker` / `mqtt-in` / `mqtt-out` pattern.
- `iot-telemetry` Topic and QoS fields added to editor. Topic falls back to `msg.topic`; `msg.qos` overrides QoS per message.
- `iot-command` Topic (required) and QoS fields added to editor. Auto-acknowledge and `msg.sendResponse()` removed — use a separate publish node to send responses.
- `sql` outputs rows in `msg.payload` only; `msg.result` removed.
- `db-connection` auth type labels clarified (e.g. "Config File Auth" → "DB Token — Config File"). Existing nodes unaffected.

### Fixed
- `oci-config` Instance/Resource Principal async builder not awaited — caused `getPassphrase is not a function` on Test Connection.
- OCI service nodes (`oci-notification`, `oci-object-storage`, `oci-logging`, `oci-log-analytics`, `iot-send-command`) passed a Promise instead of a resolved auth provider to SDK clients.
- `dequeue` ADT NJS-106 crash — payload read after `connection.close()`. Fixed by extracting payloads before closing.
- `dequeue` Continuous mode hanging deploy shutdown with "Close timed out". Fixed with coordinated `connection.break()` stop path.
- `db-connection` Resource Principal and Session Token bypassed the `extensionOci` plugin (missing dispatch case / wrong key ID format). Both now implemented directly via `accessToken` callback.
- `iot-send-command` duration fields now validated as ISO 8601 before calling OCI; `msg.responseEndpoint` only set when Wait for Response is enabled.

---

## [0.3.1] - 2026-03-23

### Added
- `oci-logging` node for OCI Logging Ingestion (`putLogs`) to write events to OCI Custom Logs
- `oci-log-analytics` node files (`oci-nodes/nodes/oci-log-analytics.html`, `oci-nodes/nodes/oci-log-analytics.js`)
- `oci-logging` node files (`oci-nodes/nodes/oci-logging.html`, `oci-nodes/nodes/oci-logging.js`)
- `oci-object-storage` node files (`oci-nodes/nodes/oci-object-storage.html`, `oci-nodes/nodes/oci-object-storage.js`)

### Changed
- Updated OCI node documentation (installation guide, README, and node reference) to include `oci-object-storage`, `oci-logging` and `oci-log-analytics`

### Fixed
- `oci-logging` now reports response status code from SDK response instead of hardcoded `200`
- Added payload-size guard rails in `oci-logging` and `oci-log-analytics` to reject oversized log records before API submission
- Message-passing consistency updates in `db-nodes/nodes/sql.js`, `db-nodes/nodes/enqueue.js`, `db-nodes/nodes/dequeue.js`, `db-nodes/nodes/begin-transaction.js`, and `oci-nodes/nodes/iot-telemetry.js` to preserve upstream `msg` properties and `msg.transaction` context where required

---

## [0.3.0] - 2026-03-10

### Added
- `oci-config` shared authentication node for OCI services (Config File, Instance Principal, Resource Principal, API Key)
- `oci-notification` node for publishing to OCI Notifications topics (email, Slack, PagerDuty, webhook, SMS, OCI Functions)
- `iot-config` MQTT connection node for the OCI IoT Platform (Basic and Certificate auth, persistent sessions, auto-reconnect)
- `iot-telemetry` node for publishing device telemetry to the IoT Platform
- `iot-command` node for receiving commands from the IoT Platform with auto-acknowledge
- `iot-send-command` node for sending commands to devices via the OCI REST API
- Dequeue Mode dropdown on `dequeue` (Remove, Browse, Locked)
- Commit/Rollback action toggle on `end-transaction` for explicit error handling
- Test Connection button on `iot-config`

### Changed
- `end-transaction` now supports Rollback action for error paths — wire success to commit, errors to rollback
- `dequeue` mode changed from hardcoded Locked to configurable Remove

### Fixed
- `dequeue` returning the same message endlessly (was using `AQ_DEQ_MODE_LOCKED` instead of `AQ_DEQ_MODE_REMOVE`)
- `end-transaction` committing on error paths because flow doesn't stop after downstream failures

---

## [0.2.0] - 2026-03-02

### Added
- `fusion-request`, `scm-lookup`, `begin-transaction`, `end-transaction`, `smo-transformer`, and `delete-transaction` nodes
- 3-source payload mappings on all SCM transaction nodes (dequeued data, msg property, static value)
- Test Connection button on `db-connection`
- SQL Source dropdown on `sql` (Editor / msg.sql)
- `msg.payload` fallback on `enqueue`
- URL override pattern and updated help text on all nodes

### Fixed
- Dequeue checkbox not saving, proxy not working on SCM nodes, transaction ID not set on delete, wrong endpoint on create-meter-reading, region field masked as password, documentation (node reference, best practices, installation guide, import examples, readme)

---

## [0.1.0] - 2026-02-27

Initial release. Previously untagged code now retroactively tagged as baseline.

### Included
- DB nodes: `db-connection`, `begin-transaction`, `end-transaction`, `dequeue`, `enqueue`, `sql`
- SCM nodes: `scm-server`, `create-asset`, `create-meter-reading`, `misc-transaction`, `subinventory-quantity-transfer`, `get-ib-asset`, `get-meter-reading`, `get-organization-id`
- Documentation: node reference, best practices, installation guide, import examples, AQ setup guide

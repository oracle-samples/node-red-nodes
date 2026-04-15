# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.4.1] - 2026-04-15

### Changed
- `sql` now participates in begin/end transaction flows — reuses `msg.transaction.connection` when wired inside a `begin-transaction`/`end-transaction` block.
- `sql` handles Oracle `q'...'` alternative-quoting literals in the bind pre-scan (all delimiter styles: `[]`, `{}`, `<>`, `()`, same-character) so quoted content is not mistaken for bind variables.
- Dependencies updated: `oci-sdk` bumped to `^2.129.0` (root, oci-nodes).

### Fixed
- `db-connection` pool initialization race — in-flight promise guard prevents parallel pool creation under concurrent startup.
- `db-connection` close path now waits for in-flight pool creation before shutdown so redeploy/stop cannot leave a newly created pool unclosed.
- `db-connection` standalone connection leak — connection now closed if NLS/session init fails after connect.
- `db-connection` pool fields now preserve driver defaults when left blank (blanks were coerced to `0`).
- `db-connection` config-file auth path now resolves from runtime user home (`~/.oci/config`) instead of hardcoded `/home/opc`.
- `create-asset`, `create-meter-reading`, `misc-transaction`, `subinventory-quantity-transfer` — error handler now calls `done(err)` correctly, fixing Catch node routing on failures.
- `oci-config`, `oci-notification`, `oci-object-storage` — concurrent async client/provider initialization deduplicated with in-flight promise guards.
- `scm-server` token cache no longer immediately invalidates when `expires_in` is under 30 seconds.
- `dequeue` continuous mode retry close handler no longer shadows the Node-RED `done` callback.
- `iot-command` now debounces temporary command status reset timers to avoid unbounded timer buildup under high command throughput.

---

## [0.4.0] - 2026-04-14

### Added
- `iot-update-relationship` node for updating OCI IoT digital twin relationship content via the control-plane REST API.
- `db-connection` NLS/session settings — `NLS_LANGUAGE`, `NLS_TERRITORY`, `TIME_ZONE`, `NLS_NUMERIC_CHARACTERS`, `NLS_DATE_FORMAT`, `NLS_TIMESTAMP_FORMAT`, `NLS_TIMESTAMP_TZ_FORMAT`, and `Advanced (restricted)` fields apply `ALTER SESSION` statements after every new connection and use a tag fingerprint on pool connections to avoid redundant re-application.

### Changed
- `delete-transaction` accepts `msg.mode` to override the Delete Mode at runtime (`"asset"`, `"meter"`, `"misc"`, `"subinventory"`, `"custom"`); unrecognised mode values now fail fast with a clear error instead of silently routing to the wrong endpoint.
- `iot-update-relationship` now uses a single output for success and routes failures through Catch (`done(err)`), aligning error handling with the rest of the node set.
- Dependency maintenance and packaging hardening: `fusion-scm-nodes` now uses `axios@^1.15.0`; `oci-nodes` now declares `mqtt` for standalone installs; root and `oci-nodes` now pin `oci-sdk` to `2.128.0`; `db-nodes` OCI SDK-family dependencies (`oci-common`, `oci-identitydataplane`) were upgraded to `^120.2.0`; installation docs now include explicit `oracledb` native module reliability guidance.
- `scm-lookup`, `get-ib-asset`, `get-meter-reading`, `get-organization-id` — `msg.*` query value now takes precedence over the editor-configured value (previously config won when both were set).
- `fusion-request` accepts `msg.method` to override the configured HTTP method at runtime (case-insensitive).
- `scm-server` token refresh is now deduplicated — concurrent callers during expiry wait for a single in-flight fetch instead of each issuing their own request; token lifetime uses `expires_in` from the OAuth response (with a 30-second safety buffer), falling back to the configured Expiry Fallback when `expires_in` is absent; request timeout of 30 seconds added to prevent indefinite hangs.
- `scm-server` enforces HTTPS on the Token URL at deploy time; required config fields (`Hostname`, `API Version`, `Token URL`, `Scope`) now raise a clear error on deploy if left blank.
- SCM HTTP request nodes (`fusion-request`, `scm-lookup`, `create-asset`, `create-meter-reading`, `misc-transaction`, `subinventory-quantity-transfer`, `get-ib-asset`, `get-meter-reading`, `get-organization-id`) now set a 30-second axios timeout to avoid indefinite hangs when upstream endpoints or proxies stall.
- `scm-lookup` query values are now encoded with `URLSearchParams` so special characters in query values cannot break the URL structure; custom URLs with existing query parameters are extended safely via `URL.searchParams`.
- `scm-lookup` custom mode now requires both Query Param and Query Value — the node errors immediately if either is missing or if both are absent.
- `get-organization-id`, `get-ib-asset`, `get-meter-reading` lookup queries now use `URLSearchParams` encoding so special characters in parameter values cannot break query structure.
- `delete-transaction` now uses a generic `resourceId` field/runtime override (`msg.resourceId`) across all delete modes, adds `custom` mode with mode-driven `Custom URL`, URL-encodes resource IDs in path construction, and applies a 30-second delete request timeout.
- SCM nodes with an `Endpoint` preview field now default to `Select SCM Server to preview endpoint` when no server is selected; delete/lookup editors keep the dedicated top-section layout and custom-mode/override paths show custom URL values.
- `fusion-request`, `create-asset`, `create-meter-reading`, `misc-transaction`, and `subinventory-quantity-transfer` no longer support `Override URL`; typed transaction nodes now always use their canonical SCM endpoint, and custom endpoint routing is done via `fusion-request` with `Transaction Type = custom`.
- `fusion-request` custom endpoint editor section now matches `delete-transaction`/`scm-lookup` UI patterns (Endpoint preview, `Custom URL` field styling, and `Enter Custom URL to preview endpoint` placeholder behavior).
- SCM UI labels now consistently use `Miscellaneous Transaction` (instead of `Misc. Transaction`) across `fusion-request`, `delete-transaction`, and related docs.
- `delete-transaction` and `scm-lookup` custom URL fields now require a base endpoint with no query string; query params must be provided through node fields (`Resource ID` / `Query Param` + `Query Value`) instead of embedded in `Custom URL`.
- `oci-notification` — `msg.topicOcid` and `msg.title` now take precedence over the editor-configured values (previously config won when both were set).
- SCM and OCI action nodes now emit a consistent error contract on failures: `msg.error` is an object (`{ message, code }`), with `code` set to `null` when no upstream code is available.
- `get-ib-asset`, `get-meter-reading`, `get-organization-id` — Override URL removed; endpoint is now fixed to the SCM Server configuration. Use `scm-lookup` in custom mode to query alternative endpoints.
- SCM node editor consistency — `delete-transaction` Delete Mode renamed to Delete Type; `fusion-request` Transaction Type select width standardised to `200px`; `get-organization-id` Organization Name label icon corrected to `fa-hashtag`; error status on write nodes changed from generic `"failed"` to action-specific text (`"create failed"`, `"transaction failed"`, `"transfer failed"`, `"request failed"`); `delete-transaction` Resource ID hint aligned to match sibling node phrasing.
- `fusion-request` success status changed from `"success"` to `"sent"`; `misc-transaction` from `"transaction complete"` to `"submitted"`; `subinventory-quantity-transfer` from `"transfer complete"` to `"transferred"`.
- OCI action nodes (`oci-notification`, `oci-object-storage`, `oci-logging`, `oci-log-analytics`, `iot-send-command`, `iot-update-relationship`) now use action-specific error status text (`"publish failed"`, `"operation failed"`, `"ingest failed"`, `"upload failed"`, `"send failed"`, `"update failed"`) instead of the generic `"failed"`.
- DB action nodes (`sql`, `enqueue`) now use action-specific error status text (`"query failed"`, `"enqueue failed"`) instead of generic `"error"`.
- `delete-transaction` endpoint preview now updates live as the Resource ID field is typed.
- `iot-telemetry`, `iot-command` connection error status changed from generic `"error"` to `"connection error"`.
- SCM action nodes (`create-asset`, `create-meter-reading`, `misc-transaction`, `subinventory-quantity-transfer`, `delete-transaction`, `scm-lookup`, `fusion-request`, `get-ib-asset`, `get-meter-reading`, `get-organization-id`) — config-error status text lowercased (`"No SCM server"` → `"no SCM server"`); field-missing status text lowercased and made human-readable (`"No SerialNumber"` → `"no serial number"`, `"No AssetNumber"` → `"no asset number"`, `"No Organization Name"` → `"no organization name"`, `"Missing URL"` → `"no custom URL"`).
- `sql` — config-error and input-error status text lowercased (`"No DB connection"` → `"no DB connection"`, `"No msg.sql"` → `"no msg.sql"`, `"No SQL provided"` → `"no SQL provided"`).
- DB status-shape consistency: `sql` now uses `ring` for pre-execution config/input validation failures and `dot` for execution states/results; `end-transaction` commit/rollback failure status now uses `dot`.
- `smo-transformer` composite mode now re-validates required fields after fragment merge and keeps merged payloads pending until complete instead of emitting incomplete joined events.
- `smo-transformer` composite mode now requires `entityCode` and `eventTime` for incomplete fragments and fails fast when either is missing, preventing `unknown_unknown_*` key collisions.
- `dequeue` Continuous mode now supports optional DB reconnect/retry with fixed delay and configurable retry limit (`0` = unlimited) so transient DB failures no longer require a flow restart.
- `enqueue` output now emits only `msg.count` (when Output is enabled); `msg.enqueued` was removed to keep the output contract minimal.
- `enqueue` now reuses `msg.transaction.connection` when present, so begin/end transaction controls final commit/rollback instead of enqueue auto-committing on its own connection.
- Config nodes (`db-connection`, `oci-config`, `iot-config`, `scm-server`) now support an optional `Name` field; node labels prefer `Name` when set for clearer selectors.
- `iot-config` now preserves QoS `0` on subscribe/re-subscribe and validates MQTT subscription patterns so invalid wildcard usage is rejected early.
- `iot-config` Use Proxy and Proxy URL fields removed — the OCI IoT Platform only supports MQTTS on port 8883 and does not support proxy connections.
- `iot-command` and `iot-telemetry` now preserve configured QoS `0` values (no fallback coercion to `1`).
- `iot-update-relationship` now includes optional editor fallback fields for relationship key/content and an in-editor runtime override tip for `msg.*` precedence.
- `sql` Binds Mapping now provides a `...` JSONata editor button for JSONata source rows to improve expression authoring.
- `iot-config` now exposes MQTT-style advanced connection settings for `clean` session mode, `keepalive`, `reconnectPeriod`, and `connectTimeout`.
- `iot-config` now includes inline node help text covering connection/auth setup, advanced MQTT settings, and persistent-session guidance.
- `iot-config` advanced numeric inputs now clamp in the editor to supported ranges for keepalive/reconnect/connect-timeout values.
- `oci-config` and `scm-server` now include inline node help text describing auth/connection fields and usage guidance.
- `enqueue` payload editor now uses a single `...` JSON editor button for JSON/ADT payload types, aligned with Node-RED editor patterns.
- `sql` now validates SQL placeholder/bind parity before execute and reports bind mismatches with a clear node status instead of raw Oracle bind errors.
- `sql` Editor mode now blocks semicolon-chained multi-statement SQL before execute while still allowing anonymous PL/SQL blocks.
- `begin-transaction` now refreshes timeout windows on reuse and records timeout lifecycle markers (`timedOut`, `endedAt`) for downstream outcome handling.
- `end-transaction` now treats timed-out transactions as explicit errors for Catch routing and ignores duplicate end attempts with status `already ended`.
- `db-connection` editor converted from flat fieldsets to tabbed layout (Auth, Connection, Pool, NLS).
- `db-connection` `Advanced (restricted)` now enforces allowlisted session SQL (`ALTER SESSION SET ...`) with editor/runtime fail-fast validation and explicit length/statement limits.

### Fixed
- `iot-config` subscriber callback exceptions are now contained and logged instead of escaping the MQTT message handler.
- `iot-config` Test Connection endpoint now uses single-response guards/cleanup to avoid timeout/connect error response races.
- `iot-config` close path now has a safety timeout so Node-RED shutdown does not hang if MQTT client end callbacks do not fire.
- `iot-command` now rejects invalid MQTT wildcard topic patterns at startup instead of attempting a broken subscription.
- `iot-telemetry` now validates `msg.qos` overrides and falls back to configured QoS when runtime override values are invalid.
- `begin-transaction` now clears tracked timeout handles on node close/redeploy to prevent orphan timeout callbacks.
- `end-transaction` no longer attempts cleanup rollback on null/closed connections after timeout-driven close paths.
- `create-asset`, `create-meter-reading`, `misc-transaction`, and `subinventory-quantity-transfer` editor endpoint previews now repopulate correctly when an SCM Server is selected.

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

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
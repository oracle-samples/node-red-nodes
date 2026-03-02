# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.0] - 2025-XX-XX

### Added
- `fusion-request`, `scm-lookup`, `begin-transaction`, `end-transaction`, and `delete-transaction` nodes
- 3-source payload mappings on all SCM transaction nodes (dequeued data, msg property, static value)
- Test Connection button on `db-connection`
- SQL Source dropdown on `sql` (Editor / msg.sql)
- `msg.payload` fallback on `enqueue`
- URL override pattern and updated help text on all nodes

### Fixed
- Dequeue checkbox not saving, proxy not working on SCM nodes, transaction ID not set on delete, wrong endpoint on create-meter-reading, region field masked as password, documentation (node reference, best practices, installation guide, import examples, readme)

---

## [0.1.0] - 2025-02-27

Initial release. Previously untagged code now retroactively tagged as baseline.

### Included
- DB nodes: `db-connection`, `begin-transaction`, `end-transaction`, `dequeue`, `enqueue`, `sql`
- SCM nodes: `scm-server`, `create-asset`, `create-meter-reading`, `misc-transaction`, `subinventory-quantity-transfer`, `get-ib-asset`, `get-meter-reading`, `get-organization-id`
- Documentation: node reference, best practices, installation guide, import examples, AQ setup guide
# Node-RED Oracle Cloud Nodes

This project provides a set of custom Node-RED nodes that integrate the Oracle Database, Advanced Queues (AQ), Oracle Fusion Cloud SCM, OCI services, and the OCI IoT Platform.

## What's Included

- **db-nodes**
  - Database connection (with Test Database Connection)
  - SQL execution (Editor or msg.sql)
  - AQ enqueue / dequeue (configurable dequeue mode, continuous retry/reconnect controls)
  - Transactional processing (begin / end transaction with commit or rollback)

- **fusion-scm-nodes**
  - General transaction node (fusion-request)
  - General lookup node (scm-lookup), including normalized complete Fusion GET URLs, subinventory, on-hand quantity, recipe/batch, and manufacturing child-resource lookups
  - `smart operations transformer`
  - `smart operations event` (submit operational events)
  - Manufacturing work order create/update
  - `manage manufacturing work order details`: operations, components, resources, serials, and progress
  - `manufacturing production transaction`: operation, material/ingredient, and output product reporting
  - Maintenance work order create/update
  - `manage maintenance work order details`: operations, materials, resources, and cost transactions
  - `create installed base asset`, `create meter reading`
  - Inventory transactions (misc/account-alias receipt/issue, subinventory transfer)
  - `delete scm record`
  - Lookup nodes (asset, meter reading, organization)

- **oci-nodes**
  - OCI authentication config (Config File, Instance Principal, Resource Principal, API Key)
  - `oci-streaming-config`, `oci-streaming-out`, `oci-streaming-in`, and `oci-streaming-commit` for publishing and consuming native OCI Streaming with automatic or explicit consumer-group commits
  - `oci-kafka-config`, `oci-kafka-producer`, `oci-kafka-consumer`, and `oci-kafka-commit` for publishing and consuming OCI Managed Kafka (OCI Streaming with Apache Kafka) topics over TLS with automatic or explicit offset commits
  - `oci-functions-invoke` for synchronous or detached OCI Functions invocation
  - `oci-queue-config`, `oci-queue-out`, `oci-queue-in`, and `oci-queue-ack` for publish, long-poll receive, and explicit acknowledgement
  - OCI Notifications (email, Slack, PagerDuty, webhook, SMS, OCI Functions)
  - OCI Object Storage (upload and download objects)
  - OCI Logging (putLogs to OCI Custom Logs)
  - OCI Log Analytics (upload log events to Log Analytics)
  - ORDS Config, ORDS Request, and ORDS Poll (OAuth-backed ORDS access with IoT Data API shortcuts)
  - IoT Device config (MQTT connection to OCI IoT Platform)
  - IoT Telemetry (publish device telemetry)
  - IoT Subscribe (receive commands delivered by OCI IoT through an MQTT request endpoint)
  - IoT Send Command (send commands to devices via OCI REST API)
  - IoT Get Content (read digital twin instance content via OCI REST API)
  - IoT Update Relationship (update digital twin relationship content via OCI REST API)

> Detailed node-level documentation is available in [Node Reference](./docs/node-reference.md).

## Quick Start

| Description | Resource |
|-------------|:--------:|
| Detailed installation | [Guide](./docs/installation.md) |
| Setup Oracle AQ (queue + subscriber using SQL) | [Guide](./docs/setup-sql.md) |
| Import examples into Node-RED | [Guide](./docs/import-examples.md) |
| Best practices | [Guide](./docs/best-practice.md) |
| Node reference | [Guide](./docs/node-reference.md) |

## Installation

### 1. Clone the Repository

Navigate to your Node-RED user directory (`~/.node-red`) and clone using one of the following methods:

#### HTTPS
```bash
git clone https://github.com/oracle-samples/node-red-nodes.git
```

#### SSH
```bash
git clone git@github.com:oracle-samples/node-red-nodes.git
```

#### GitHub CLI
```bash
gh repo clone oracle-samples/node-red-nodes
```

### 2. Install the Node Package

#### Prerequisites

- Node-RED v3.0+
- Node.js v18+
- npm
- Oracle Client libraries supported by node-oracledb (required only when DB `Driver Mode` is `Thick`)

#### Package Installation

Install the node package using the [installation guide](./docs/installation.md#12-install-dependencies). Its dependencies are installed automatically; installing dependency libraries alone does not register the nodes.

ORDS request/poll nodes use Node.js v18+ built-in HTTP APIs and do not require an additional npm package.

#### Oracle Client Libraries

Thin mode does not require Oracle Client libraries. For Thick mode, follow the [platform-specific installation instructions](./docs/installation.md#oracle-client-setup-thick-mode-only).

### Local Install Note (Palette Manager Upload)

For local/offline installs via the Node-RED editor, you must generate an npm-packed tarball yourself with `npm pack`.
GitHub source/release tarballs are not directly uploadable in Palette Manager because they do not use the expected npm archive layout (`package/package.json`).

See [Detailed installation: Install from Local `.tgz` in Palette Manager](./docs/installation.md#13-install-from-local-tgz-in-palette-manager).

## Documentation

You can find the online documentation for the Oracle Internet of Things Platform at [docs.cloud.oracle.com](https://docs.oracle.com/en-us/iaas/Content/internet-of-things).

## Examples

The repository includes six importable Node-RED examples:

- [AQ Subscriber and Message Processing](./db-nodes/examples/sql-enqueue-dequeue.json)
- [AQ Meter Reading Submission](./fusion-scm-nodes/examples/scm-meter-reading-asset-fallback.json)
- [Conditional Asset Creation](./fusion-scm-nodes/examples/conditional-asset-creation.json)
- [Inventory Transactions](./fusion-scm-nodes/examples/inventory-transactions.json)
- [Sample Device Fault Handling](./fusion-scm-nodes/examples/iot-fusion-maintenance-closed-loop.json)
- [Device Telemetry and Commands](./oci-nodes/examples/alert-shutdown-threshold.json)

Examples can be imported directly into the Node-RED editor.
See [Import Examples Guide](./docs/import-examples.md).

## Contributing

This project welcomes contributions from the community. Before submitting a pull request, please [review our contribution guide](./CONTRIBUTING.md).

## Security

Please consult the [security guide](./SECURITY.md) for our responsible security vulnerability disclosure process.

## License

See [LICENSE](./LICENSE.txt).

## Disclaimer

Oracle and its affiliates do not provide any warranty whatsoever, express or implied, for any software, material or content of any kind contained or produced within this repository, and in particular specifically disclaim any and all implied warranties of title, non-infringement, merchantability, and fitness for a particular purpose. Furthermore, Oracle and its affiliates do not represent that any customary security review has been performed with respect to any software, material or content contained or produced within this repository. In addition, and without limiting the foregoing, third parties may have posted software, material or content to this repository without any review. Use at your own risk.

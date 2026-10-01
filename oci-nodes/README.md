# Node-RED OCI Nodes

Custom Node-RED nodes for Oracle Cloud Infrastructure (OCI) service integration and the OCI IoT Platform. These nodes enable native OCI Streaming publishing and consumption, managed Kafka publishing and consumption, Functions invocation, Queue processing, OCI Notifications, OCI Logging, OCI Log Analytics, Object Storage file transfer, IoT device telemetry, and command-response workflows.

## Nodes

### Configuration

| Node | Category | Description |
|------|----------|-------------|
| **oci-config** | config | OCI authentication for REST API nodes. Supports Config File, Instance Principal, Resource Principal, and API Key. |
| **oci-streaming-config** | config | Shared OCI authentication, Stream OCID, and Messages endpoint for native OCI Streaming. |
| **oci-kafka-config** | config | TLS and SASL/SCRAM-SHA-512 connection for OCI Managed Kafka (OCI Streaming with Apache Kafka). |
| **oci-queue-config** | config | Shared OCI Queue authentication, queue OCID, and queue-specific Messages endpoint. |
| **ords-config** | config | ORDS OAuth client-credentials configuration for ORDS request and polling nodes. |
| **iot-config** | config | MQTT connection to the OCI IoT Platform. Supports Basic and Certificate auth, persistent sessions, command subscriptions, and advanced connection tuning (clean session, keepalive, reconnect period, connect timeout). MQTTS on port 8883 only. |

### OCI Services

| Node | Category | Description |
|------|----------|-------------|
| **oci-api-request** | oci | Sends signed OCI HTTPS requests with configurable methods, response decoding, and timeouts. |
| **oci-monitoring-publish** | oci | Publishes one custom metric data point per input message. |
| **oci-monitoring-query** | oci | Queries OCI Monitoring metric series using MQL. |
| **oci-streaming-out** | oci | Publishes one record or an explicit batch to native OCI Streaming. |
| **oci-streaming-in** | oci | Consumes native OCI Streaming through a consumer group with automatic or manual commits. |
| **oci-streaming-commit** | oci | Explicitly commits a record emitted by Streaming In in Manual mode. |
| **oci-kafka-producer** | oci | Publishes `msg.payload` to a configured or message-routed managed Kafka topic. |
| **oci-kafka-consumer** | oci | Consumes one managed Kafka topic with automatic or manual offset commits. |
| **oci-kafka-commit** | oci | Explicitly commits a record emitted by Kafka Consumer in Manual mode. |
| **oci-functions-invoke** | oci | Invokes an OCI Function synchronously or detached. |
| **oci-queue-out** | oci | Publishes one message or an explicit batch of up to 20 OCI Queue messages. |
| **oci-queue-in** | oci | Long-polls OCI Queue and emits receipt-bearing messages without auto-deleting them. |
| **oci-queue-ack** | oci | Explicitly acknowledges successful processing by deleting a received queue message. |
| **oci-notification** | oci | Publishes messages to OCI Notifications topics (email, Slack, PagerDuty, webhook, SMS, OCI Functions). |
| **oci-log-analytics** | oci | Uploads log events to OCI Log Analytics for search, parsing, and analytics workflows. |
| **oci-logging** | oci | Pushes log entries to OCI Logging (Custom Logs) using the Logging Ingestion API (`putLogs`). |
| **oci-object-storage** | oci | Uploads and downloads objects to/from OCI Object Storage using payloads or local file paths. |
| **oci-ords-request** | oci | Sends one-shot ORDS HTTP requests using custom relative paths, with IoT Data API presets as shortcuts. |
| **oci-ords-poll** | oci | Polls ORDS endpoints, including command delivery/response status through Raw Command Data. |

### IoT — Cloud Side (REST API via oci-config)

| Node | Category | Description |
|------|----------|-------------|
| **iot-send-command** | oci | Sends commands to devices via the OCI REST API. |
| **iot-get-content** | oci | Reads digital twin instance content via the OCI REST API. |
| **iot-update-relationship** | oci | Updates digital twin relationship content via the OCI REST API. |

### IoT — Device Side (MQTT via iot-config)

| Node | Category | Description |
|------|----------|-------------|
| **iot-subscribe** | oci | Receives commands delivered by OCI IoT to the configured device through an MQTT request endpoint. |
| **iot-telemetry** | oci | Publishes telemetry data to the IoT Platform. |

## Installation

### Prerequisites

- Node-RED v2.0+
- Node.js v18+ (see the [dependency compatibility note](https://github.com/oracle-samples/node-red-nodes/blob/v0.7.1/docs/installation.md))
- An OCI tenancy with appropriate IAM policies

### Install the Node Package

Install the node package using the [installation guide](https://github.com/oracle-samples/node-red-nodes/blob/v0.7.1/docs/installation.md). Its dependencies are installed automatically; installing dependency libraries alone does not register the nodes.

ORDS request/poll nodes use Node.js v18+ built-in HTTP APIs and do not require an additional npm package.

## Error Handling

On older Node-RED versions, read a supplied error code with `msg.error?.code || msg._error?.code`; not every external error includes a code.

OCI, IoT REST, and ORDS action nodes route failures through Catch nodes and keep the normal output success-only. Catch messages include `msg.error = { message, code }`; when OCI SDK or ORDS responses include server-side detail text, that text is promoted into `msg.error.message`. Existing OCI/ORDS request nodes preserve response bodies in `msg.payload` when available, with recognized credential fields and credential patterns redacted from diagnostics. Catch errors contain sanitized details rather than the original SDK request/error object. Redaction is a safeguard, not a guarantee that arbitrary provider text contains no sensitive data. Streaming Out, Streaming Commit, Kafka Producer, Kafka Commit, Functions Invoke, Queue Out, and Queue Ack preserve their input payload on failure.

## Authentication

### oci-config (OCI REST API Authentication)

Used by: `oci-api-request`, `oci-monitoring-publish`, `oci-monitoring-query`, `oci-streaming-config`, `oci-functions-invoke`, `oci-queue-config`, `oci-notification`, `oci-logging`, `oci-log-analytics`, `oci-object-storage`, `iot-send-command`, `iot-get-content`, `iot-update-relationship`

| Auth Type | When to Use | Fields Required |
|-----------|-------------|-----------------|
| **Config File** | Local dev, VMs with OCI CLI configured | Config file path, profile name |
| **Instance Principal** | Running on OCI compute instance | None — credentials from instance metadata |
| **Resource Principal** | Running inside OCI Functions | None — credentials from environment |
| **API Key (Simple)** | Explicit credentials without a config file | Tenancy OCID, User OCID, Fingerprint, Private Key path |

> **Note:** Instance Principal and Resource Principal only work inside OCI. Config File and API Key work from any machine.

Use **Test OCI Credentials** after deploy to validate the selected authentication mode.

### oci-streaming-config (Native OCI Streaming)

Used by: `oci-streaming-out`, `oci-streaming-in`

Configure the target Stream OCID and the HTTPS Messages endpoint shown on the native OCI stream details page. The config creates one shared data-plane client from the selected `oci-config`. Streaming Out requires `stream-push`; Streaming In requires `stream-pull`. Streaming In supports Automatic mode for simple delivery and Manual mode with Streaming Commit when downstream success must control progress. A public stream pool is reachable through its public endpoint; a private stream pool additionally requires working VCN routing and DNS from the Node-RED host.

### oci-kafka-config (Managed Kafka Authentication)

Used by: `oci-kafka-producer`, `oci-kafka-consumer`

Kafka broker authentication is separate from OCI API request signing. Configure the SASL/SCRAM bootstrap `host:port` entries from the managed Kafka cluster, a Client ID, the cluster's SASL/SCRAM superuser name, and the generated password stored in the manually generated OCI Vault secret associated with that cluster. The password is stored in Node-RED credentials. Connections always use TLS with SASL/SCRAM-SHA-512. Use **Test Kafka Connection** after deploy.

Kafka Consumer supports Automatic commits for simple delivery and Manual commits for workflows that should advance only after Kafka Commit succeeds. Automatic mode records source-node delivery, not successful downstream processing. Use Manual mode and commit after processing when failed work must remain eligible for replay; keep downstream processing idempotent because replay can repeat completed side effects.

### iot-config (MQTT Device Authentication)

Used by: `iot-telemetry`, `iot-subscribe`

| Auth Type | When to Use | Fields Required |
|-----------|-------------|-----------------|
| **Basic** | Most common for testing and development | Username (external-key), Password (Vault secret) |
| **Certificate (mTLS)** | Production devices with X.509 certificates | Client cert path, Client key path |

`iot-config` also provides advanced MQTT connection settings: `clean` session mode (default `false`), `keepalive` (default `60s`), `reconnectPeriod` (default `5000ms`), and `connectTimeout` (default `30000ms`).

Use **Test MQTT Connection** after deploy to validate the Device Host and selected authentication mode.

### ords-config (ORDS OAuth Authentication)

Used by: `oci-ords-request`, `oci-ords-poll`

| Auth Type | When to Use | Fields Required |
|-----------|-------------|-----------------|
| **OAuth Client Credentials** | ORDS / IoT Data API HTTP access | Base URL, Token URL, Client ID, Client Secret; Scope is optional when required by the ORDS resource |

Supplied OAuth token lifetimes, including lifetimes below 30 seconds, are honored with a safety buffer. Invalid supplied lifetimes fail acquisition; the configured fallback applies only when the lifetime is absent. ORDS Poll applies its timeout to the complete local polling operation, including waiting for a slot and authentication; timeout cancels the local request but does not undo remote operations.

Use **Test OAuth Token** after deploy to validate token acquisition independently of an ORDS resource request.

## IoT Platform Setup

Before using IoT nodes, set up the following in OCI:

1. **IoT Domain Group and Domain** — creates the MQTT broker and database
2. **Vault Secret** — stores the device password for Basic auth
3. **Digital Twin Instance** — registers the device identity

See [OCI IoT Documentation](https://docs.oracle.com/en-us/iaas/Content/internet-of-things) for step-by-step instructions.

## Typical Flows

These are wiring patterns, not separate example files. The package's importable flow is [Device Telemetry and Commands](./examples/alert-shutdown-threshold.json).

**Publish telemetry every 10 seconds:**
`inject` (with JSON payload or use function node to build payload) → `iot telemetry`

**Receive device commands:**
`iot-subscribe` → `debug`

**Send a command to a device:**
`inject` (JSON payload) → `iot send command` → `debug`

**Read twin content:**
`inject` (optional runtime overrides) → `iot get content` → `debug`

**Check command status through ORDS:**
`iot send command` (outputs `msg.recordId`) → `oci ords poll` (Command Status) → `debug`

**Update relationship content:**
`inject` (relationshipKey + content) → `iot update relationship` → `debug` (success/failure)

**Alert on threshold breach:**
`dequeue` → `switch` (condition) → `oci notification`

**Publish an enriched event to managed Kafka:**
`function` → `kafka producer` → `debug`

**Consume managed Kafka records:**
`kafka consumer` → processing nodes → `debug`

**Transform an event with OCI Functions:**
`inject` / `dequeue` → `functions invoke` → `debug`

**Reliably process an OCI Queue message:**
`queue in` → processing nodes → `queue ack`; route processing failures to a Catch path without acknowledging the message

**Write custom application events to OCI Logging:**
`function` (build payload) → `oci logging` → `debug`

**Upload events to OCI Log Analytics:**
`dequeue` / `function` → `oci log analytics` → `debug`

**Upload a file/object to Object Storage:**
`inject` (payload or file path) → `oci object storage` (upload) → `debug`

**Download an object from Object Storage:**
`inject` → `oci object storage` (download) → `debug` / `file`

**Deliver a command to a device:**
`inject` → `iot send command` → `debug` (command sent)
`iot-subscribe` → `debug` (command received on the configured MQTT request endpoint)

**Sample fault telemetry to Fusion SCM:**
`inject` (sample telemetry) → `smart operations transformer` → `smart operations event`; fault branch → `maintenance work order` and `iot send command`

## Contributing

This project welcomes contributions from the community. Before submitting a pull request, please [review our contribution guide](./CONTRIBUTING.md).

## Security

Please consult the [security guide](./SECURITY.md) for our responsible security vulnerability disclosure process.

## License

See [LICENSE](./LICENSE.txt).

## Disclaimer

Oracle and its affiliates do not provide any warranty whatsoever, express or implied, for any software, material or content of any kind contained or produced within this repository, and in particular specifically disclaim any and all implied warranties of title, non-infringement, merchantability, and fitness for a particular purpose. Furthermore, Oracle and its affiliates do not represent that any customary security review has been performed with respect to any software, material or content contained or produced within this repository. In addition, and without limiting the foregoing, third parties may have posted software, material or content to this repository without any review. Use at your own risk.


Both nodes prefer `msg.digitalTwinInstanceId` when supplied and reject invalid new overrides. Without it, existing precedence is preserved: Get Content prefers legacy `msg.digitalTwinOcid` over configuration; Send Command prefers the configured identifier over the legacy property. The saved `digitalTwinOcid` field remains supported.

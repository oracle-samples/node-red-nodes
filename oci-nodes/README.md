# Node-RED OCI Nodes

Custom Node-RED nodes for Oracle Cloud Infrastructure (OCI) service integration and the OCI IoT Platform. These nodes enable OCI Notifications, OCI Logging, OCI Log Analytics, Object Storage file transfer, IoT device telemetry, and command-response workflows.

## Nodes

### Configuration

| Node | Category | Description |
|------|----------|-------------|
| **oci-config** | config | OCI authentication for REST API nodes. Supports Config File, Instance Principal, Resource Principal, and API Key. |
| **iot-config** | config | MQTT connection to the OCI IoT Platform. Supports Basic and Certificate auth, persistent sessions, command subscriptions, and advanced connection tuning (clean session, keepalive, reconnect period, connect timeout). MQTTS on port 8883 only. |

### OCI Services

| Node | Category | Description |
|------|----------|-------------|
| **oci-notification** | oci | Publishes messages to OCI Notifications topics (email, Slack, PagerDuty, webhook, SMS, OCI Functions). |
| **oci-logging** | oci | Pushes log entries to OCI Logging (Custom Logs) using the Logging Ingestion API (`putLogs`). |
| **oci-log-analytics** | oci | Uploads log events to OCI Log Analytics for search, parsing, and analytics workflows. |
| **oci-object-storage** | oci | Uploads and downloads objects to/from OCI Object Storage using payloads or local file paths. |

### IoT — Device Side (MQTT via iot-config)

| Node | Category | Description |
|------|----------|-------------|
| **iot-telemetry** | oci | Publishes telemetry data to the IoT Platform. |
| **iot-command** | oci | Receives commands from the IoT Platform and sends acknowledgments. |

### IoT — Cloud Side (REST API via oci-config)

| Node | Category | Description |
|------|----------|-------------|
| **iot-send-command** | oci | Sends commands to devices via the OCI REST API. |
| **iot-update-relationship** | oci | Updates digital twin relationship content via the OCI REST API. |

## Installation

### Prerequisites

- Node-RED v3.0+
- Node.js v18+
- An OCI tenancy with appropriate IAM policies

### Install Dependencies

Inside your Node-RED user directory (`~/.node-red`):

```bash
npm install oci-sdk    # OCI Notifications, Logging, Log Analytics, Object Storage, IoT Send Command
npm install mqtt       # IoT Telemetry, IoT Command
```

## Authentication

### oci-config (OCI REST API Authentication)

Used by: `oci-notification`, `oci-logging`, `oci-log-analytics`, `oci-object-storage`, `iot-send-command`, `iot-update-relationship`

| Auth Type | When to Use | Fields Required |
|-----------|-------------|-----------------|
| **Config File** | Local dev, VMs with OCI CLI configured | Config file path, profile name |
| **Instance Principal** | Running on OCI compute instance | None — credentials from instance metadata |
| **Resource Principal** | Running inside OCI Functions | None — credentials from environment |
| **API Key (Simple)** | Explicit credentials without a config file | Tenancy OCID, User OCID, Fingerprint, Private Key path |

> **Note:** Instance Principal and Resource Principal only work inside OCI. Config File and API Key work from any machine.

### iot-config (MQTT Device Authentication)

Used by: `iot-telemetry`, `iot-command`

| Auth Type | When to Use | Fields Required |
|-----------|-------------|-----------------|
| **Basic** | Most common for testing and development | Username (external-key), Password (Vault secret) |
| **Certificate (mTLS)** | Production devices with X.509 certificates | Client cert path, Client key path |

`iot-config` also provides advanced MQTT connection settings: `clean` session mode (default `false`), `keepalive` (default `60s`), `reconnectPeriod` (default `5000ms`), and `connectTimeout` (default `30000ms`).

## IoT Platform Setup

Before using IoT nodes, set up the following in OCI:

1. **IoT Domain Group and Domain** — creates the MQTT broker and database
2. **Vault Secret** — stores the device password for Basic auth
3. **Digital Twin Instance** — registers the device identity

See [OCI IoT Documentation](https://docs.oracle.com/en-us/iaas/Content/internet-of-things) for step-by-step instructions.

## Typical Flows

**Publish telemetry every 10 seconds:**
`inject` (with JSON payload or use function node to build payload) → `iot telemetry`

**Receive and log all commands:**
`iot command` → `debug`

**Send a command to a device:**
`inject` (JSON payload) → `iot send command` → `debug`

**Update relationship content:**
`inject` (relationshipKey + content) → `iot update relationship` → `debug` (success/failure)

**Alert on threshold breach:**
`dequeue` → `switch` (condition) → `oci notification`

**Write custom application events to OCI Logging:**
`function` (build payload) → `oci logging` → `debug`

**Upload events to OCI Log Analytics:**
`dequeue` / `function` → `oci log analytics` → `debug`

**Upload a file/object to Object Storage:**
`inject` (payload or file path) → `oci object storage` (upload) → `debug`

**Download an object from Object Storage:**
`inject` → `oci object storage` (download) → `debug` / `file`

**Full command round-trip:**
`inject` → `iot send command` → `debug` (command sent)
`iot command` → `debug` (command received on device)

## Contributing

This project welcomes contributions from the community. Before submitting a pull request, please [review our contribution guide](../CONTRIBUTING.md).

## Security

Please consult the [security guide](../SECURITY.md) for our responsible security vulnerability disclosure process.

## License

See [LICENSE](../LICENSE.txt).

## Disclaimer

Oracle and its affiliates do not provide any warranty whatsoever, express or implied, for any software, material or content of any kind contained or produced within this repository, and in particular specifically disclaim any and all implied warranties of title, non-infringement, merchantability, and fitness for a particular purpose. Furthermore, Oracle and its affiliates do not represent that any customary security review has been performed with respect to any software, material or content contained or produced within this repository. In addition, and without limiting the foregoing, third parties may have posted software, material or content to this repository without any review. Use at your own risk.

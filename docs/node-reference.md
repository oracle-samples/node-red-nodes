# Node Reference

This page documents each node, its configuration fields, outputs, and usage.

---

## Database Nodes

### db-connection (Config Node)

Defines how Node-RED connects to the Oracle Database. All other DB nodes reference this config node.

| Field | Required | Description |
|-------|----------|-------------|
| Auth Type | Yes | Basic, Config File, Instance Principal, or Simple |
| External Auth | No | Enables external token authentication |
| Username | Basic only | Database username |
| Password | Basic only | Database password |
| TNS String | Yes | Connect descriptor or TNS alias |
| Config File Location | Config File only | Path to OCI config file (default: `/home/opc/.oci/config`) |
| Profile | Config File only | Profile name in config file (default: `DEFAULT`) |
| Fingerprint | Simple only | API key fingerprint |
| Private Key Location | Simple only | Path to private key file |
| Passphrase | Simple only | Private key passphrase |
| Region ID | Simple only | OCI region |
| Tenancy OCID | Simple only | Tenancy OCID |
| User OCID | Simple only | User OCID |
| Use Pool | No | Enables a reusable connection pool |
| Pool Min | Pool only | Minimum connections in pool |
| Pool Max | Pool only | Maximum connections in pool |
| Pool Increment | Pool only | Connections added when pool grows |
| Queue Timeout | Pool only | Timeout for pool queue in milliseconds |
| Test Connection | — | Button to verify credentials (deploy first, then test) |

### begin-transaction

Opens a database connection and stores it in `msg.transaction.connection` for downstream nodes.

| Field | Required | Description |
|-------|----------|-------------|
| DB Connection | Yes | References a db-connection config node |
| Timeout (seconds) | No | Auto-rollback if end-transaction isn't reached within this time. Set to `0` for no timeout. |

**Outputs:** `msg.transaction.connection` (live connection), `msg.transaction.startedAt` (timestamp in ms)

If `msg.transaction.connection` already exists, the existing connection is reused.

### end-transaction

Commits or rolls back the transaction connection and closes it. Shows elapsed time in status.

| Field | Required | Description |
|-------|----------|-------------|
| Action | Yes | **Commit** (default): commits all changes, dequeued messages are permanently removed. **Rollback**: rolls back all changes, dequeued messages return to the queue. |

**Commit** shows status "committed (2.3s)". **Rollback** shows status "rolled back (2.3s)".

On failure: always rolls back, closes connection, and reports the error regardless of the selected action.

**Error handling pattern:** Wire the success path to a commit end-transaction and the error path (via a catch node) to a rollback end-transaction:

```
begin transaction → dequeue → fusion-request → end transaction (commit)
                                     ↓ (error)
                               catch → end transaction (rollback)
```

### dequeue

Dequeues messages from an Oracle AQ queue.

| Field | Required | Description |
|-------|----------|-------------|
| DB Connection | Yes | References a db-connection config node |
| Queue Name | Yes | AQ queue name (e.g. `SCHEMA.JSON_QUEUE`) |
| Subscriber | No | Consumer name for multi-consumer queues |
| Dequeue Mode | No | **Remove** (default): message is permanently removed on commit. **Browse**: message is read but stays in the queue. **Locked**: message is locked but stays in the queue on commit. |
| Block Indefinitely | No | Waits forever for messages if checked |
| Blocking Time (seconds) | No | Wait time if not blocking indefinitely |
| Batch Size | No | Messages per dequeue (default: 1) |

**Dequeue modes:**

| Mode | On dequeue | On commit | Use case |
|------|-----------|-----------|----------|
| **Remove** | Reads and marks for removal | Message permanently deleted | Normal message consumption |
| **Browse** | Reads without locking | Message stays, anyone can read it again | Monitoring or inspecting queue contents |
| **Locked** | Reads and locks | Lock released, message stays | Inspect before deciding to remove |

**Outputs:** `msg.payload` (message payload), `msg.dequeued` (same, for SCM payload mapping compatibility)

**Transactional mode:** When wired after begin-transaction, uses `msg.transaction.connection`. Messages stay locked on the queue until end-transaction commits or rolls back.

**Standalone mode:** When used without transaction nodes, creates its own connection with auto-commit. A warning is logged: "Dequeue running without transaction."

### enqueue

Enqueues JSON messages into an Oracle AQ queue.

| Field | Required | Description |
|-------|----------|-------------|
| DB Connection | Yes | References a db-connection config node |
| Queue Name | Yes | AQ queue name |
| Recipients | No | Comma-separated subscriber names for multi-consumer queues |
| User Payload | No | JSON array of messages. If empty, uses `msg.payload` |

### sql

Executes SQL statements against the Oracle Database.

| Field | Required | Description |
|-------|----------|-------------|
| DB Connection | Yes | References a db-connection config node |
| SQL Source | No | `Editor` (default) uses the textarea; `msg.sql` reads the query from `msg.sql` at runtime |
| SQL | Editor only | SQL statement to execute |
| Binds (JSON) | No | Bind variables as a JSON array (`[val1, val2]`) or named object (`{"id": 123}`) |
| Max Rows | No | Maximum rows returned (default: 1000, max: 10000) |

**Outputs:** `msg.payload` (array of row objects), `msg.result` (same, for backward compatibility)

> **Important:** This node uses `autoCommit: false`. DML statements (INSERT, UPDATE, DELETE) are not committed and will roll back when the connection closes. Use a PL/SQL block with explicit `COMMIT` for DML, or use begin/end transaction nodes.

---

## SCM Nodes

### scm-server (Config Node)

Stores OAuth credentials, hostname, API version, and proxy settings. All SCM nodes reference this config.

| Field | Required | Description |
|-------|----------|-------------|
| Client ID | Yes | OAuth client ID |
| Client Secret | Yes | OAuth client secret |
| Scope | Yes | Token scope |
| Token URL | Yes | OAuth token endpoint URL |
| Hostname | Yes | Fusion Cloud hostname |
| Version | Yes | REST API version (e.g. `11.13.18.05`) |
| Use Proxy | No | Enables proxy for outbound requests |
| Proxy URL | Proxy only | Proxy URL used by axios |

### fusion-request

Unified SCM transaction node. Supports multiple transaction types in a single interface.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Transaction Type | Yes | Create Asset, Create Meter Reading, Misc. Transaction, Subinventory Transfer, or Custom |
| Method | Yes | HTTP method (GET, POST, PUT, PATCH, DELETE) |
| Override URL | No | Check to provide a custom endpoint URL |
| Payload Mappings | Yes | Structured rows mapping SCM fields to values (see Payload Mappings below) |

**Outputs:** `msg.payload` (API response), `msg.statusCode`, `msg.error` (on failure)

### scm-lookup

Unified SCM lookup node. Supports multiple query types.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Lookup Type | Yes | Installed Base Asset, Meter Reading, Organization ID, or Custom |
| Query Value | Yes | The value to search for (e.g. Serial Number, Asset Number) |
| Override URL | No | Check to provide a custom endpoint URL |

**Outputs:** `msg.payload` (API response), `msg.statusCode`, `msg.error` (on failure)

### smo-transformer

Transforms incoming telemetry or message data into structured SMO event payloads for Oracle Fusion Cloud.

> **Important:** The smo-transformer processes one message at a time. Place a **split** node (fixed length: 1) before it when processing batches.

| Field | Required | Description |
|-------|----------|-------------|
| Event Type | Yes | Preset event type or custom |
| Entity Code Fields | Yes | Ordered list of payload fields for entity identifier (first match wins) |
| Field Mappings | Yes | Maps incoming fields to outgoing SMO data fields |
| Nesting | No | Wraps mapped fields in a nested object |
| Composite | No | Holds partial messages until all required fields are present |
| JSONata Override | No | Replaces all field mapping configuration |

**Outputs:** `msg.payload` (structured SMO event object)

### create-asset / create-meter-reading / misc-transaction / subinventory-quantity-transfer

Individual SCM transaction nodes. Each targets a specific REST endpoint.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Override URL | No | Check to provide a custom endpoint URL |
| Payload Mappings | Yes | Structured rows mapping SCM fields to values |

**Outputs:** `msg.payload` (API response), `msg.statusCode`, `msg.error` (on failure)

### delete-transaction

Deletes a transaction by TransactionInterfaceId.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Resource Type | Yes | Asset, Meter, Misc, or Subinventory |
| Transaction Interface ID | No | If empty, reads from `msg.transactionInterfaceId` |

### get-ib-asset / get-meter-reading / get-organization-id

Individual SCM lookup nodes. Each queries a specific REST endpoint.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Query field (varies) | Yes | Serial Number, Asset Number, or Organization Name depending on node |

**Outputs:** `msg.payload` (API response), `msg.statusCode`, `msg.error` (on failure)

---

## OCI Nodes

### oci-config (Config Node)

Shared authentication for all OCI REST API nodes. Uses the OCI SDK for TypeScript and JavaScript.

| Field | Required | Description |
|-------|----------|-------------|
| Auth Type | Yes | Config File, Instance Principal, Resource Principal, or API Key |
| Config File Path | Config File only | Path to OCI config file (default: `~/.oci/config`) |
| Profile | Config File only | Profile name (default: `DEFAULT`) |
| Tenancy OCID | API Key only | `ocid1.tenancy.oc1...` |
| User OCID | API Key only | `ocid1.user.oc1...` |
| Fingerprint | API Key only | API key fingerprint |
| Private Key Path | API Key only | Path to PEM private key file |
| Passphrase | API Key only | Private key passphrase (optional) |
| Region | Yes | OCI region (e.g. `us-ashburn-1`) |
| Compartment OCID | No | Default compartment for child nodes |
| Test Connection | — | Calls `listRegions()` to verify credentials |

> **Note:** Instance Principal and Resource Principal only work inside OCI. Config File and API Key work from any machine.

### oci-notification

Publishes messages to an OCI Notifications topic.

| Field | Required | Description |
|-------|----------|-------------|
| OCI Config | Yes | References an oci-config node |
| Topic OCID | No* | Notification topic OCID. *Required either here or in `msg.topicOcid` |
| Title | No | Message title (email subject). Falls back to `msg.title` |
| Body | No | Message body. Falls back to `msg.payload` (objects are JSON-stringified) |

**Outputs:** `msg.payload` (publish result with `messageId`), `msg.statusCode`, `msg.error` (on failure)

### iot-config (Config Node)

MQTT connection to the OCI IoT Platform. Manages persistent sessions, command subscriptions, and auto-reconnect.

| Field | Required | Description |
|-------|----------|-------------|
| Device Host | Yes | MQTT broker hostname from your IoT Domain |
| Base Endpoint | Yes | Topic prefix (default: `iot/v1`). Derives telemetry, command, and response topics. |
| Client ID | Yes | MQTT client ID (typically the device/digital twin name) |
| QoS | No | Quality of Service: 0, 1 (default), or 2 |
| Auth Type | Yes | Basic (username/password) or Certificate (mTLS) |
| Username | Basic only | Digital twin `external-key` |
| Password | Basic only | Vault secret content |
| CA Cert | Cert only | Path to CA certificate (usually not needed) |
| Client Cert | Cert only | Path to client certificate PEM |
| Client Key | Cert only | Path to client private key PEM |
| Test Connection | — | Creates a temporary MQTT connection to verify credentials |

Connects with `clean: false` (persistent session) so the IoT Platform retains messages during brief disconnections. Auto-reconnects every 5 seconds.

### iot-telemetry

Publishes telemetry data to the IoT Platform via MQTT.

| Field | Required | Description |
|-------|----------|-------------|
| IoT Config | Yes | References an iot-config node |
| Auto Timestamp | No | Adds `time` field (epoch microseconds) if not present. Default: enabled. |

**Input:** `msg.payload` (telemetry data object)

**Outputs:** `msg.payload` (passed through), `msg.topic` (MQTT topic published to)

### iot-command

Receives commands from the IoT Platform and optionally sends automatic acknowledgments.

| Field | Required | Description |
|-------|----------|-------------|
| IoT Config | Yes | References an iot-config node |
| Auto Acknowledge | No | Sends an ack to `rsp/<key>` when a command is received. Default: enabled. |
| Command Key | No | Filter to only receive commands matching this key. Leave empty for all commands. |

**Outputs:** `msg.payload` (command data), `msg.commandKey` (extracted from topic), `msg.topic`, `msg.sendResponse` (function for manual ack)

This node has **no input** — commands arrive from the IoT Platform over MQTT.

### iot-send-command

Sends commands to devices via the OCI REST API.

| Field | Required | Description |
|-------|----------|-------------|
| OCI Config | Yes | References an oci-config node (not iot-config — this uses the REST API) |
| Digital Twin OCID | No* | Device to send the command to. *Required either here or in `msg.digitalTwinOcid` |
| Base Endpoint | Yes | Topic prefix (default: `iot/v1`) |
| Command Key | No | Command identifier. Falls back to `msg.commandKey` (default: `"default"`) |
| Wait for Response | No | Includes response endpoint so the platform waits for device ack. Default: enabled. |
| Request Duration | No | ISO 8601 delivery timeout (default: `PT10M` = 10 minutes) |
| Response Duration | No | ISO 8601 ack timeout (default: `PT10M`) |

**Input:** `msg.payload` (command data to send to device)

**Outputs:** `msg.payload` (API response), `msg.statusCode`, `msg.commandKey`, `msg.requestEndpoint`, `msg.responseEndpoint`

---

## SCM Payload Mappings

All SCM transaction nodes use structured mapping rows:

| Source | Reads from | Value field contains |
|--------|-----------|---------------------|
| **dequeued data** | `msg.dequeued.<value>` | Field name (e.g. `AssetNumber`) |
| **msg property** | `msg.<value>` | Full property path (e.g. `payload.someField`) |
| **static value** | Literal string | Constant value (e.g. `100100100`) |

---

## Typical Flows

**Transactional dequeue → SCM create (with error handling):**
`begin transaction` → `dequeue` → `fusion-request` → `end transaction (commit)`
On error: `catch` → `end transaction (rollback)`

**IoT telemetry publishing:**
`inject` (repeat 10s) → `function` (build sensor payload) → `iot telemetry`

**IoT command round-trip:**
`inject` (command payload) → `iot send command` → `debug` (sent)
`iot command` → `debug` (received on device)

**Threshold monitoring with notification:**
`dequeue` → `switch` (temperature < 20?) → `iot send command` (shutdown) → `oci notification` (alert)

**SQL query:**
`inject` → `sql` → `debug`
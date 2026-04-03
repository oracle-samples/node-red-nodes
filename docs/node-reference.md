# Node Reference

This page documents each node, its configuration fields, outputs, and usage.

## Database Nodes

### db-connection (Config Node)

Defines how Node-RED connects to the Oracle Database. All other DB nodes reference this config node.

| Field | Required | Description |
|-------|----------|-------------|
| Auth Type | Yes | Basic, DB Token — Config File, DB Token — Instance Principal, DB Token — Resource Principal, DB Token — Session Token, or DB Token — API Key |
| Driver Mode | No | `thick` (default) or `thin`. Thick uses Oracle Client libraries; Thin uses the pure JavaScript driver |
| External Auth | No | Enables external token authentication (required for all DB Token types) |
| Username | Basic only | Database username |
| Password | Basic only | Database password |
| TNS String | Yes | Connect descriptor or TNS alias |
| Wallet Path | No | Optional wallet/config directory path. Passed to node-oracledb as `configDir` and `walletLocation` |
| Config File Location | Config File / Session Token | Path to OCI config file (default: `/home/opc/.oci/config`) |
| Profile | Config File / Session Token | Profile name in config file (default: `DEFAULT`) |
| Fingerprint | Simple only | API key fingerprint |
| Private Key Location | Simple only | Path to private key file |
| Passphrase | Simple only | Private key passphrase |
| Region ID | Simple only | OCI region |
| Tenancy OCID | Simple only | Tenancy OCID |
| User OCID | Simple only | User OCID |
| Proxy User | DB Token only | Optional. Enables Oracle proxy authentication — the token identity connects; the proxy user sets the effective DB session |
| Use Pool | No | Enables a reusable connection pool |
| Pool Min | Pool only | Minimum connections in pool |
| Pool Max | Pool only | Maximum connections in pool |
| Pool Increment | Pool only | Connections added when pool grows |
| Queue Timeout | Pool only | Timeout for pool queue in milliseconds |
| Test Connection | — | Button to verify credentials (deploy first, then test) |

Driver mode behavior:

| Behavior | Thick | Thin |
|----------|-------|------|
| Runtime scope | Process-wide after first DB connection initialization | Process-wide after first DB connection initialization |
| DB Token + Proxy User | Not supported (node fails fast with a clear error) | Allowed to proceed to driver behavior |

> **Important:** Node-oracledb mode is process-wide in a single Node-RED runtime. The first active `db-connection` node to initialize the driver sets the mode. Later nodes requesting a different mode will continue using the already-initialized runtime mode and log a warning. Restart Node-RED to switch modes.
> In Thick mode, if `ORACLE_CLIENT_LIB` is set it is used as `libDir`; otherwise node-oracledb default platform library lookup is used.

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
| Mode | No | **Transactional** (default): triggered by an incoming msg, supports begin/end-transaction. **Continuous**: auto-starts on deploy, long-polls with `AQ_DEQ_WAIT_FOREVER`, auto-commits after each batch — no rollback protection. |
| Queue Name | Yes | AQ queue name (e.g. `SCHEMA.JSON_QUEUE`) |
| Subscriber | No | Consumer name for multi-consumer queues |
| Payload Type | No | **JSON** (default): payload parsed as a JS object. **RAW**: payload as a `Buffer` (convert with `.toString()`). **ADT**: payload as a plain JS object converted from an Oracle DbObject — field names are uppercase. |
| Object Type | ADT only | Schema-qualified Oracle object type name (e.g. `ADMIN.MY_MSG_TYPE`) |
| Dequeue Mode | No | **Remove** (default): message is permanently removed on commit. **Browse**: message is read but stays in the queue. **Locked**: message is locked but stays in the queue on commit. |
| Block Indefinitely | No | Waits forever for messages if checked (Transactional mode only) |
| Blocking Time (seconds) | No | Wait time if not blocking indefinitely (Transactional mode only) |
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

**Continuous mode:** Starts on deploy with no input trigger, then dequeues with `AQ_DEQ_WAIT_FOREVER`. On redeploy/stop, the node interrupts the blocking dequeue call so close can finish promptly without timing out.

### enqueue

Enqueues JSON messages into an Oracle AQ queue.

| Field | Required | Description |
|-------|----------|-------------|
| DB Connection | Yes | References a db-connection config node |
| Queue Name | Yes | AQ queue name |
| Recipients | No | Comma-separated subscriber names for multi-consumer queues |
| Delivery Mode | No | **Persistent** (default): written to queue table, survives restarts. **Buffered**: Oracle shared memory only, faster but lost on DB restart — requires thick client mode. |
| Payload Type | No | **JSON** (default): enqueues JS objects. **RAW**: enqueues strings as UTF-8 Buffers. **ADT**: instantiates Oracle DbObjects from JS objects using the configured object type. |
| Object Type | ADT only | Schema-qualified Oracle object type name (e.g. `ADMIN.MY_MSG_TYPE`) |
| User Payload | No | A single object or JSON array. A single object is enqueued as one message; each array element becomes a separate message. If empty, uses `msg.payload` (accepts both shapes). |
| Output | No | When enabled (default), sends a msg after successful enqueue. Disable to use as a pure sink. |

**Outputs (when enabled):** `msg.enqueued` (array of messages sent), `msg.count` (number of messages enqueued). All upstream `msg` properties are preserved.

### sql

Executes SQL statements against the Oracle Database.

| Field | Required | Description |
|-------|----------|-------------|
| DB Connection | Yes | References a db-connection config node |
| SQL Source | No | `Editor` (default) uses the textarea; `msg.sql` reads the query from `msg.sql` at runtime |
| SQL | Editor only | SQL statement to execute |
| Binds Source | No | `Editor` (default) uses Binds Mapping rows; `msg.binds` reads bind values from `msg.binds` at runtime |
| Binds Mapping | Editor only | Reorderable bind rows: bind variable + source type (`static text`, `number`, `boolean`, `date`, `msg property`, `JSONata`). `date` defaults to `SYSDATE` (current runtime time) but can be edited to any valid date/datetime string. |
| Max Rows | No | Maximum rows returned (default: 1000, max: 10000) |

**Outputs:** `msg.payload` (array of row objects)

> **Important:** This node uses `autoCommit: false`. DML statements (INSERT, UPDATE, DELETE) are not committed and will roll back when the connection closes. Use a PL/SQL block with explicit `COMMIT` for DML, or use begin/end transaction nodes.

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

### oci-object-storage

Uploads and downloads objects in OCI Object Storage.

| Field | Required | Description |
|-------|----------|-------------|
| OCI Config | Yes | References an oci-config node |
| Operation | Yes | `upload` or `download` |
| Namespace | No* | Object Storage namespace. *Required either here or in `msg.namespace` |
| Bucket Name | No* | Bucket name. *Required either here or in `msg.bucketName` |
| Object Name | No* | Object name. *Required either here or in `msg.objectName` |
| File Path | No | Upload source path when `msg.payload` is empty, or download destination path |
| Content Type | No | Upload content type (for example `application/json`) |
| Download Output | No | `buffer` (default) or `text` |
| Encoding | No | Text encoding used when Download Output is `text` (default: `utf8`) |

**Runtime overrides:** `msg.operation`, `msg.namespace`, `msg.bucketName`, `msg.objectName`, `msg.filePath`, `msg.contentType`, `msg.downloadOutput`, `msg.encoding`

**Upload input:** `msg.payload` (Buffer, string, stream, Uint8Array, or object)

**Outputs:** `msg.payload`, `msg.statusCode`, plus object metadata (`msg.eTag`, `msg.contentType`, `msg.contentLength`, `msg.versionId`, `msg.opcRequestId`) on download

### oci-logging

Pushes log records to OCI Logging Custom Logs using the Logging Ingestion API (`putLogs`).

| Field | Required | Description |
|-------|----------|-------------|
| OCI Config | Yes | References an oci-config node |
| Log OCID | No* | Custom Log OCID. *Required either here or in `msg.logId` |
| Log Source | No | Producer/source label (default: `node-red`). Overridden by `msg.logSource` |
| Log Type | No | Type/category label (default: `application.events`). Overridden by `msg.logType` |
| Default Severity | No | Injected as `level` when payload object has no `level` field. Overridden by `msg.severity` |
| Payload Source | No | `Payload Mappings` (default) or `msg.payload` |
| Payload Mappings | No | Mapping rows from dequeued data, msg property, or static value |

**Runtime inputs:** `msg.logId` (used when node Log OCID is blank), `msg.logSource`, `msg.logType`, `msg.logSubject`, `msg.severity`

**Outputs:** `msg.payload.opcRequestId`, `msg.payload.statusCode`, `msg.statusCode`, `msg.error` (on failure)

### oci-log-analytics

Uploads log events to OCI Log Analytics using `uploadLogEventsFile`.

| Field | Required | Description |
|-------|----------|-------------|
| OCI Config | Yes | References an oci-config node |
| Namespace | No* | Tenancy namespace. *Required either here or in `msg.namespace` |
| Log Group OCID | No* | Log Analytics log group OCID. *Required either here or in `msg.logGroupOcid` |
| Log Source Name | No* | Log source name configured in Log Analytics. *Required either here or in `msg.logSourceName` |
| Entity OCID | No | Optional Log Analytics entity. Can be overridden by `msg.entityOcid` |
| Default Severity | No | Injected as `level` when payload object has no `level` field. Overridden by `msg.severity` |
| Payload Source | No | `Payload Mappings` (default) or `msg.payload` |
| Payload Mappings | No | Mapping rows from dequeued data, msg property, or static value |

**Runtime overrides:** `msg.namespace`, `msg.logGroupOcid`, `msg.logSourceName`, `msg.entityOcid`, `msg.severity`

**Outputs:** `msg.payload.statusCode`, `msg.payload.requestId`, `msg.statusCode`, `msg.error` (on failure)

### iot-config (Config Node)

MQTT connection to the OCI IoT Platform. Manages persistent sessions, command subscriptions, and auto-reconnect.

| Field | Required | Description |
|-------|----------|-------------|
| Device Host | Yes | MQTT broker hostname from your IoT Domain |
| Client ID | Yes | MQTT client ID (typically the device/digital twin name) |
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
| Topic | No | MQTT topic to publish to. Leave blank to use `msg.topic` at runtime |
| QoS | No | MQTT QoS level (0, 1, or 2). Can be overridden per message via `msg.qos` |
| Auto Timestamp | No | Adds `time` field (epoch microseconds) if not present. Default: enabled. |

**Input:** `msg.payload` (telemetry data), `msg.topic` (used when Topic field is blank), `msg.qos` (overrides configured QoS)

**Outputs:** `msg.payload` (passed through), `msg.topic` (MQTT topic published to)

### iot-command

Subscribes to an MQTT topic and outputs a message whenever a command arrives. This node has **no input** — messages arrive from the broker.

| Field | Required | Description |
|-------|----------|-------------|
| IoT Device | Yes | References an iot-config node for the MQTT connection |
| Topic | Yes | MQTT topic to subscribe to. Supports `#` (multi-level) and `+` (single-level) wildcards |
| QoS | Yes | Subscription QoS level (0, 1, or 2) |

**Outputs:** `msg.payload` (JSON object or string — JSON is auto-detected), `msg.commandKey` (portion of the topic matched by `#`, or last segment for fixed topics), `msg.topic` (full received topic)

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

**Outputs:** `msg.payload` (API response), `msg.statusCode`, `msg.commandKey`, `msg.requestEndpoint`, `msg.responseEndpoint` (only when Wait for Response is enabled)

`iot-send-command` validates Request/Response Duration values before calling OCI and rejects invalid ISO 8601 duration strings.

## SCM Payload Mappings

All SCM transaction nodes use structured mapping rows:

| Source | Reads from | Value field contains |
|--------|-----------|---------------------|
| **dequeued data** | `msg.dequeued.<value>` | Field name (e.g. `AssetNumber`) |
| **msg property** | `msg.<value>` | Full property path (e.g. `payload.someField`) |
| **static value** | Literal string | Constant value (e.g. `100100100`) |

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

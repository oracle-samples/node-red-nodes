# Node Reference

This page documents each node, its configuration fields, outputs, and usage.

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

Commits and closes the transaction connection. Shows elapsed time in status (e.g. "committed (2.3s)").

| Field | Required | Description |
|-------|----------|-------------|
| *(none)* | — | Reads `msg.transaction` from upstream |

On failure: rolls back, closes connection, and reports the error.

### dequeue

Dequeues messages from an Oracle AQ queue.

| Field | Required | Description |
|-------|----------|-------------|
| DB Connection | Yes | References a db-connection config node |
| Queue Name | Yes | AQ queue name (e.g. `SCHEMA.JSON_QUEUE`) |
| Subscriber | No | Consumer name for multi-consumer queues |
| Block Indefinitely | No | Waits forever for messages if checked |
| Blocking Time (seconds) | No | Wait time if not blocking indefinitely |
| Batch Size | No | Messages per dequeue (default: 1) |

**Outputs:** `msg.payload` (array of messages), `msg.dequeued` (first message for single-message flows)

**Transactional mode:** When wired after begin-transaction, uses `msg.transaction.connection`. Messages stay locked on the queue until end-transaction commits. If the flow fails, messages roll back automatically.

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

Selecting a transaction type auto-populates the endpoint URL and default field mappings. Choose "Custom" to target any Fusion SCM REST endpoint.

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

Transforms incoming telemetry or message data into structured SMO event payloads for Oracle Fusion Cloud. Supports preset event types with auto-populated field mappings, custom event types, value transforms, composite message joining, and JSONata overrides.

> **Important:** The smo-transformer processes one message at a time. If the upstream node produces an array of messages (e.g. from a dequeue with batch size > 1), you must place a **split** node before the smo-transformer configured with a fixed length of **1**. Without the split node, the transformer receives the entire array as a single payload and will not process individual messages correctly.

| Field | Required | Description |
|-------|----------|-------------|
| Event Type | Yes | Preset event type or custom. Presets auto-populate field mappings and settings. |
| Entity Code Fields | Yes | Ordered list of payload fields to check for the entity identifier (first match wins). Default: `deviceId`, `machineId`. |
| Field Mappings | Yes | Maps incoming payload fields to outgoing SMO data fields (see Field Mappings below). |
| Nesting | No | Wraps all mapped fields inside a nested object with the specified key. |
| Composite | No | Enables composite message joining — holds partial messages until all required fields are present. |
| Required Fields | Composite only | All listed fields must be present before a composite message is considered complete and sent. |
| Split Fields | Composite only | Splits a single incoming field by a delimiter into two output fields (e.g. `operationNumber` → `WORK_ORDER_NUMBER` + `OPERATION_SEQUENCE`). |
| Stale Timeout | Composite only | Seconds to wait before flushing an incomplete composite message. Set to `0` to disable. |
| JSONata Override | No | Advanced. If provided, replaces all field mapping configuration. The full `msg` object is available. |

**Preset event types:**

| Preset | Description |
|--------|-------------|
| CA_FAULT | Machine fault codes |
| CA_STATUS | Machine status (maps numeric states to DOWN/IN_USE/IDLE) |
| CA_OPERATION_EXECUTION_START | Work order operation start (composite) |
| CA_OPERATION_EXECUTION_STOP | Work order operation stop |
| CA_QUANTITY_REPORT (Complete \| Reject) | Production quantity reporting — complete or reject |
| CA_QUANTITY_REPORT (Inspect) | Inspection quantity reporting with inspection characteristics (composite) |
| CA_OPERATIONAL_PARAMETERS | Operational parameter readings (temperature, pressure, etc.) |
| CA_METERS | Meter readings (odometer, fuel level, operating hours) with nesting |

**Field mapping transform types:**

| Transform | Description |
|-----------|-------------|
| None | Pass through as-is |
| String | Convert to string |
| Number | Convert to number |
| Static Value | Write a constant value (no incoming field needed) |
| Value Map | Lookup table. Use the key `__present__` to map based on field existence rather than value. |
| Nested Object | Pass through an entire object |
| Collect Flat Fields | Gather named flat fields into a single nested object |
| Dynamic Sift | Copy all payload fields except those in an exclude list |

**First match wins:** When multiple incoming fields map to the same outgoing field, the first match found in the payload is used. This allows fallback patterns (e.g. check `FAULT_CODE` first, then `faultCode`).

**Output structure:**

```json
{
  "entityCode": "",
  "eventTypeCode": "",
  "eventTime": "",
  "data": { ... mapped fields ... }
}
```

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


## SCM Payload Mappings

All SCM transaction nodes (fusion-request, create-asset, create-meter-reading, misc-transaction, subinventory-quantity-transfer) use structured mapping rows:

| Column | Description |
|--------|-------------|
| **SCM Field** | The API field name (e.g. `AssetNumber`, `ItemNumber`) |
| **Source** | How the value is resolved (see below) |
| **Value** | The field name, property path, or literal value depending on source |

**Source types:**

| Source | Reads from | Value field contains |
|--------|-----------|---------------------|
| **dequeued data** | `msg.dequeued.<value>` | Just the field name (e.g. `AssetNumber`) — the `msg.dequeued.` prefix is added automatically |
| **msg property** | `msg.<value>` | Full property path (e.g. `payload.someField`, `custom.data.id`) |
| **static value** | Literal string | The constant value (e.g. `100100100`) |

Rows can be reordered by dragging the ☰ handle. Add or remove rows with the + Add Mapping / ✕ buttons. New rows default to "dequeued data" source.


## Typical Flows

**Transactional dequeue → SCM create:**
`begin transaction` → `dequeue` → `fusion-request` → `end transaction`

**Standalone dequeue → SCM create:**
`dequeue` → `create-asset`

**Dequeue → SMO transform (batch):**
`dequeue` (batch size > 1) → `split` (fixed length: 1) → `smo-transformer`

**Dequeue → SMO transform (single):**
`dequeue` (batch size: 1) → `smo-transformer`

**SQL query:**
`inject` → `sql` → `debug`

**Dynamic SQL:**
`function` (sets msg.sql) → `sql` → `debug`

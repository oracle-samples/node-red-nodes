# Node Reference

This page documents each node, its configuration fields, outputs, and usage.

## Database Nodes

Message-triggered DB nodes keep their normal output success-only. On Catch-path failures, they set `msg.error` to `{ message, code }` using the Oracle/node-oracledb error text and code when available; DB nodes leave the current `msg.payload` unchanged on failure.

### db-connection (Config Node)

Defines how Node-RED connects to the Oracle Database. All other DB nodes reference this config node.

| Field | Required | Description |
|-------|----------|-------------|
| Name | No | Optional display name shown in config selectors and node labels |
| Auth Type | Yes | Basic, DB Token — Config File, DB Token — Instance Principal, DB Token — Resource Principal, DB Token — Session Token, or DB Token — API Key |
| Driver Mode | No | `thick` (default) or `thin`. Thick uses Oracle Client libraries; Thin uses the pure JavaScript driver |
| External Auth | No | Enables external token authentication (required for all DB Token types) |
| Username | Basic only | Database username |
| Password | Basic only | Database password |
| TNS String | Yes | Connect descriptor or TNS alias |
| Wallet Path | No | Wallet and network config directory. Required for ADB (mTLS) and TCPS connections. Applies to all auth types. Passed as `configDir` and `walletLocation`. |
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
| Pool Min | Pool only | Minimum connections in pool. Leave blank for driver default |
| Pool Max | Pool only | Maximum connections in pool. Leave blank for driver default |
| Pool Increment | Pool only | Connections added when pool grows. Leave blank for driver default |
| Queue Timeout | Pool only | Timeout for pool queue in milliseconds. Leave blank for driver default |
| NLS_LANGUAGE | No | Oracle session language for messages and date names. Leave blank for server default. |
| NLS_TERRITORY | No | Oracle session territory for number/date conventions. Leave blank for server default. |
| TIME_ZONE | No | Session time zone. Region name (`UTC`) or offset (`-05:00`). Leave blank for server default. |
| NLS_NUMERIC_CHARACTERS | No | Decimal and group separator — exactly two characters (e.g. `,.`). |
| NLS_DATE_FORMAT | No | Format mask for DATE columns (e.g. `YYYY-MM-DD`). |
| NLS_TIMESTAMP_FORMAT | No | Format mask for TIMESTAMP columns. |
| NLS_TIMESTAMP_TZ_FORMAT | No | Format mask for TIMESTAMP WITH TIME ZONE columns. |
| Advanced (restricted) | No | Optional advanced session SQL. Only `ALTER SESSION SET ...` statements are allowed. Statements are semicolon-separated, max 10 statements, max 1000 total characters. |
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

**Outputs:** `msg.transaction.connection` (live connection), `msg.transaction.startedAt` (timestamp in ms), `msg.transaction.timedOut` (set when timeout auto-rollback fires), `msg.transaction.endedAt` (timeout end timestamp in ms)

If `msg.transaction.connection` already exists, the existing connection is reused. When Timeout is enabled, the reuse path refreshes the timeout window.

### end-transaction

Commits or rolls back the transaction connection and closes it. Shows elapsed time in status.

| Field | Required | Description |
|-------|----------|-------------|
| Action | Yes | **Commit** (default): commits all changes, dequeued messages are permanently removed. **Rollback**: rolls back all changes, dequeued messages return to the queue. |

**Commit** shows status "committed (2.3s)". **Rollback** shows status "rolled back (2.3s)".

On failure: always rolls back, closes connection, and reports the error regardless of the selected action.
If the transaction already timed out upstream, status is set to "timed out" and the node routes `Transaction timed out` through Catch with `msg.error` populated.
If the message reaches `end-transaction` after the transaction has already ended, the node sets status "already ended" and exits without a second commit/rollback attempt.
If an imported flow provides an invalid Action value, the node logs a warning and defaults to commit behavior.

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
| Enable Retries | Continuous only | Retry after DB errors in continuous mode (default: enabled). |
| Retry Delay (ms) | Continuous only | Fixed delay before each reconnect attempt (default: `5000`). |
| Max Retries | Continuous only | Maximum reconnect attempts after a failure. `0` means unlimited (default). |
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

**Continuous mode:** Starts on deploy with no input trigger, then dequeues with `AQ_DEQ_WAIT_FOREVER`. On DB errors, the node retries connection/dequeue automatically when retries are enabled. On redeploy/stop, the node interrupts the blocking dequeue call (and any retry wait) so close can finish promptly without timing out.

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
| User Payload | No | A single object or JSON array. A single object is enqueued as one message; each array element becomes a separate message. If empty, uses `msg.payload` (accepts both shapes). For JSON/ADT payload types, the editor provides a `...` JSON editor button. |
| Output | No | When enabled (default), sends a msg after successful enqueue. Disable to use as a pure sink. |

**Outputs (when enabled):** `msg.count` (number of messages enqueued). All upstream `msg` properties are preserved.

**Transactional mode:** When wired after begin-transaction, uses `msg.transaction.connection` and does not auto-commit. Enqueued messages are finalized by end-transaction commit/rollback.

**Standalone mode:** Without transaction nodes, opens its own connection, enqueues, commits, and closes.

### sql

Executes SQL statements against the Oracle Database.

| Field | Required | Description |
|-------|----------|-------------|
| DB Connection | Yes | References a db-connection config node |
| SQL Source | No | `Editor` (default) uses the textarea; `msg.sql` reads the query from `msg.sql` at runtime |
| SQL | Editor only | SQL statement to execute |
| Binds Source | No | `Editor` (default) uses Binds Mapping rows; `msg.binds` reads bind values from `msg.binds` at runtime |
| Binds Mapping | Editor only | Reorderable bind rows: bind variable + source type (`static text`, `number`, `boolean`, `date`, `msg property`, `JSONata`). JSONata rows include a `...` button to open the expression editor. `date` defaults to `SYSDATE` (current runtime time) but can be edited to any valid date/datetime string. |
| Max Rows | No | Maximum rows returned (default: 1000, max: 10000) |

**Outputs:** `msg.payload` (array of row objects)

Before opening a DB connection, SQL placeholder parity is validated: named placeholders require object binds, positional placeholders require array binds, and missing bind values fail fast with status "binds mismatch".
SQL execution failures route to Catch with the Oracle message and error number in `msg.error`; SQL text and bind values are not copied into `msg.error`.
In SQL Source `Editor` mode, semicolon-chained multi-statement SQL is blocked before execute; a single statement is required (anonymous PL/SQL blocks remain allowed).

When `msg.transaction.connection` exists, the SQL executes on that shared transaction connection and preserves `msg.transaction` for downstream `end-transaction`.

> **Important:** This node uses `autoCommit: false`. Standalone DML statements (INSERT, UPDATE, DELETE) are not committed and will roll back when the standalone connection closes. Use a PL/SQL block with explicit `COMMIT` for standalone DML, or wire through begin/end transaction nodes.

## SCM Nodes

All SCM HTTP action/lookup/event nodes apply a 30-second outbound request timeout.

### scm-server (Config Node)

Stores OAuth credentials, hostname, API version, and proxy settings. All SCM nodes reference this config.

| Field | Required | Description |
|-------|----------|-------------|
| Name | No | Optional display name shown in config selectors and node labels |
| Client ID | Yes | OAuth client ID |
| Client Secret | Yes | OAuth client secret |
| Scope | Yes | Token scope |
| Token URL | Yes | OAuth token endpoint URL. Must use HTTPS — enforced at deploy time. |
| Hostname | Yes | Fusion Cloud hostname |
| Version | Yes | REST API version (e.g. `11.13.18.05`) |
| Use Expiry Fallback | No | When enabled, uses the configured fallback lifetime when the token response omits `expires_in` |
| Expiry Fallback (min) | No | Token cache duration in minutes used when `expires_in` is absent. Default: `60`. Ignored when `expires_in` is present — server-reported lifetime minus a 30-second safety buffer is used instead. |
| Use Proxy | No | Enables proxy for outbound requests |
| Proxy URL | Proxy only | Proxy URL used by axios |

> **Deploy-time validation:** `Hostname`, `API Version`, `Token URL`, and `Scope` must all be set before deploying. A non-HTTPS Token URL or any missing required field raises a clear error at deploy time.

Fusion SCM REST nodes keep their normal output success-only. On failures, they route to Catch with `msg.error` shaped as `{ message, code }`; when Fusion returns a validation body, `msg.error.message`, `node.error(...)`, and `done(err).message` use that Fusion text, while `msg.payload` keeps the raw response body.

### fusion-request

Unified SCM transaction node. Supports multiple transaction types in a single interface.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Transaction Type | Yes | Create Asset, Create Meter Reading, Miscellaneous Transaction, Subinventory Transfer, or Custom |
| Method | Yes | HTTP method (GET, POST, PUT, PATCH, DELETE) |
| Custom Endpoint | Custom only | Editable base endpoint URL used when Transaction Type is `custom` |
| Payload Mappings | Yes | Structured rows mapping SCM fields to values. `GET` sends mappings as query parameters; `POST`/`PUT`/`PATCH` sends mappings as the JSON body; `DELETE` does not send mappings |

New nodes default to `Transaction Type = Custom` so the workspace label stays `fusion request` until a transaction type is selected.

**Inputs (runtime overrides):** `msg.method` overrides the configured HTTP method for this message (case-insensitive; e.g. `GET`, `PATCH`)

**Outputs:** `msg.payload` (API response), `msg.statusCode`, `msg.error` (on failure, object: `{ message, code }`)

### scm-lookup

Unified SCM lookup node. Supports multiple query types.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Lookup Type | Yes | Installed Base Asset, Meter Reading, Organization ID, Item, Subinventory, On-Hand Quantity, Work Definition, Manufacturing Work Order, Maintenance Work Order, or Custom |
| Query Value | Yes | The value to search for (e.g. Serial Number, Asset Number) |
| Additional Filters | No | Optional JSON object appended to the REST `q` expression, such as `{"OrganizationCode":"M1","ItemNumber":"ASSEMBLY-100"}` |
| Custom Endpoint | Custom only | Editable base endpoint URL used when lookup type is `custom` (query string not allowed) |
| Query Param | Custom only | Oracle REST field name to filter by (e.g. `ItemNumber`). Required in custom mode — must be paired with a Query Value |
| Endpoint | Editor preview | Read-only endpoint preview based on selected Lookup Type and SCM Server |

Prerequisite lookup types target `itemsV2` by `ItemNumber`, `subinventories` by `SecondaryInventoryName`, `inventoryOnhandBalances` by `ItemNumber`, `workDefinitions` by `WorkDefinitionName`, manufacturing `workOrders` by `WorkOrderNumber`, and `maintenanceWorkOrders` by `WorkOrderNumber`. Use **Additional Filters** to narrow results by fields such as `OrganizationCode`, `SubinventoryCode`, and `ItemNumber`.

In custom mode both **Query Param** and **Query Value** are required. The node errors if either is missing. Custom Endpoint must be a base endpoint without query parameters. To hit an endpoint without a query filter, use `fusion-request` instead.

New nodes default to `Lookup Type = Custom` so the workspace label stays `scm lookup` until a lookup type is selected.

**Inputs (runtime overrides):** `msg.queryValue` overrides the Query Value field; `msg.queryFilters` overrides Additional Filters as an object or JSON object string

**Outputs:** `msg.payload` (API response), `msg.statusCode`, `msg.error` (on failure, object: `{ message, code }`)

Successful lookup requests that return an empty Fusion collection (`items: []`) still pass the response downstream, but the node status shows `not found` instead of `found`.

### smo-transformer

Transforms incoming telemetry or message data into structured SMO event payloads for Oracle Fusion Cloud.

> **Important:** The smo-transformer processes one message at a time. Place a **split** node (fixed length: 1) before it when processing batches.

| Field | Required | Description |
|-------|----------|-------------|
| Event Type | Yes | Preset event type or custom |
| Entity Code Fields | Yes | Ordered list of payload field paths for entity identifier (first match wins). Dot paths such as `device.id` are supported. |
| Event Time Fields | No | Ordered list of payload field paths for event time (first match wins). Defaults to `eventTime`. |
| Default Time | No | Explicit opt-in to use the current ISO timestamp when no configured event time field has a value. When disabled, missing event time emits `null`. |
| Output Target | No | Writes the transformed event to `msg.smoEvent` by default, preserving the original `msg.payload`. Select `msg.payload` to overwrite the payload instead. |
| Field Mappings | Yes | Maps incoming field paths to outgoing SMO `data.*` fields. Mapping rows use `Read From`, `Write To data.*`, `Convert`, and `Fallback`. |
| Sample Payload | No | Editor-only Mapping Assistant input. Paste one JSON object, or an array of JSON objects for composite fragment preview, to detect available paths, click paths into focused path fields, and preview the transformed event. Runtime input still expects one object per message. |
| Nesting | No | Wraps mapped fields in a nested object |
| Composite | No | Advanced option that holds partial messages until all required fields are present |
| Stale Timeout (seconds) | No | Optional flush timer for incomplete composite entries (`0` disables timer-based flush) |
| Max Pending Composites | No | Upper bound for pending composite entries in memory (default `1000`) |
| Max Pending Age (seconds) | No | Upper bound for how long a pending composite entry may stay in memory (default `3600`) |
| JSONata Override | No | Replaces all field mapping configuration |

**Inputs:** `msg.payload` must be a single object. Arrays and non-object payloads raise an error and can be routed to a Catch node.

**Outputs:** `msg.smoEvent` (structured SMO event object, default) or `msg.payload` when Output Target is set to `msg.payload`.

New nodes start with `Select event type...`, empty mappings, and the generic `smo transformer` workspace label. Select a preset to populate its default mappings, or add a custom event type. Messages are routed to Catch if Event Type is left blank.

The preview panel applies mapping, split field, collect-flat, value-map, nesting, and event-time settings to the sample payload. In Composite mode, array samples simulate fragment grouping by `entityCode`, `eventTime`, and `eventTypeCode`, then show merged outputs, pending fragments, and fragment-level errors. Sample payloads populate path suggestions and preview output; they do not validate whether configured paths are valid because production payloads may use aliases or variants that are not present in the pasted samples. Preview is unavailable while JSONata Override is set because JSONata is evaluated by the Node-RED runtime.

When Composite is enabled and a message is incomplete, `entityCode` and `eventTime` must both be present to build a stable composite key. Missing key parts fail fast instead of using shared fallback keys.

### smo-event

Sends structured Smart Operations operational events to Oracle Fusion Cloud SCM.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Entity Code | No | Optional fallback when `msg.entityCode`, `msg.smoEvent.entityCode`, and `msg.payload.entityCode` are absent |
| Event Type Code | No | Optional fallback when `msg.eventTypeCode`, `msg.smoEvent.eventTypeCode`, and `msg.payload.eventTypeCode` are absent |
| Default Time | No | Uses the current ISO timestamp when `eventTime` is missing |
| Endpoint | Editor preview | Read-only preview of the Smart Operations events endpoint |

**Inputs:** `msg.smoEvent` or `msg.payload` should contain `{ entityCode, eventTypeCode, eventTime, data }`. Runtime overrides `msg.entityCode`, `msg.eventTypeCode`, `msg.eventTime`, and `msg.data` take precedence over the structured event fields.

**Outputs:** `msg.payload` (API response), `msg.statusCode`, `msg.smoEvent` (submitted event body), `msg.error` (on failure, object: `{ message, code }`)

Use `smo-transformer` upstream to convert raw telemetry, camera, PLC, scanner, or MQTT payloads into the event shape before sending.

### manufacturing-work-order

Creates or updates a discrete manufacturing work order header in Oracle Fusion SCM.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Action | Yes | `Create` posts to `workOrders`; `Update` sends PATCH to `workOrders/{WorkOrderId}` |
| Work Order ID | Update only | Fusion work order resource ID. If empty, Update reads `msg.workOrderId` |
| Endpoint | Editor preview | Read-only endpoint preview based on selected SCM Server and Action |
| Payload Mappings | Yes | Structured rows mapping Fusion work order fields to values |

Create default mapping rows include `WorkOrderNumber`, `OrganizationCode`, `ItemNumber`, `WorkDefinitionName`, `WorkOrderStatusCode`, `WorkOrderTypeCode`, `PlannedStartQuantity`, `PlannedStartDate`, `PlannedCompletionDate`, and `WorkOrderDescription`. Update default rows include `WorkOrderDescription`, `WorkOrderStatusCode`, `WorkOrderTypeCode`, `PlannedStartQuantity`, `PlannedStartDate`, and `PlannedCompletionDate`. Preset row values start blank and non-static so users can choose the correct source type and path. Required create fields depend on the Fusion Manufacturing setup.

**Inputs (runtime overrides):** `msg.action` overrides the configured Action with `create` or `update`; `msg.workOrderId` supplies the resource ID for Update. Mapping rows can read from `msg.payload`, `msg.dequeued`, any message property path, typed static values including `static JSON`, or the current timestamp.

**Outputs:** `msg.payload` (API response), `msg.manufacturingWorkOrder` (same successful API response), `msg.statusCode`, `msg.error` (on failure, object: `{ message, code }`)

This node manages the work order header resource. Use `manufacturing-work-order-child` for operations, components, resources, serials, and progress/quantity reporting.

### manufacturing-work-order-child

Manages manufacturing work order child records and operation progress transactions.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Resource | Yes | Operation, Component, Resource, Serial, or Progress |
| Action | Yes | Child collections support Create, List, Get, Update, and Delete where Fusion supports them; Progress supports Create only |
| Work Order ID | Resource-dependent | Fusion manufacturing work order resource ID. If empty, reads `msg.workOrderId` |
| Operation ID | Component/Resource | Fusion operation resource ID. If empty, reads `msg.operationId` |
| Child ID | Get/Update/Delete | Operation, component, resource, or serial child record ID. If empty, reads `msg.childRecordId` |
| Endpoint | Editor preview | Read-only endpoint preview based on selected SCM Server, Resource, and Action |
| Payload Mappings | Create/Update | Structured rows mapping Fusion child-resource or operation-transaction fields to values |

Resource modes target these Fusion resources:

| Resource | Endpoint pattern |
|----------|------------------|
| Operation | `workOrders/{WorkOrderId}/child/WorkOrderOperation` |
| Component | `workOrders/{WorkOrderId}/child/WorkOrderOperation/{WorkOrderOperationId}/child/WorkOrderOperationMaterial` |
| Resource | `workOrders/{WorkOrderId}/child/WorkOrderOperation/{WorkOrderOperationId}/child/WorkOrderOperationResource` |
| Serial | `workOrders/{WorkOrderId}/child/WorkOrderSerialNumber` |
| Progress | `operationTransactions` |

Operation presets include `OperationSequenceNumber`, `OperationName`, `OperationDescription`, `WorkCenterCode`, `CountPointOperationFlag`, `AutoTransactFlag`, `PlannedStartDate`, and `PlannedCompletionDate`. Progress transaction presets default to `OperationTransactionDetail` with `static JSON` so a nested operation transaction detail array can be supplied directly; enter the array value only, not an object that wraps `OperationTransactionDetail` again.

**Inputs (runtime overrides):** `msg.resource` overrides the configured Resource; `msg.action` overrides the configured Action; `msg.workOrderId`, `msg.operationId`, and `msg.childRecordId` supply IDs when editor fields are blank. Mapping rows can read from `msg.payload`, `msg.dequeued`, any message property path, typed static values including `static JSON`, or the current timestamp.

**Outputs:** `msg.payload` (API response), `msg.manufacturingWorkOrderChild` (same successful API response), `msg.workOrderChild` (same successful API response), `msg.statusCode`, `msg.error` (on failure, object: `{ message, code }`)

### maintenance-work-order

Creates or updates a maintenance work order header in Oracle Fusion SCM.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Action | Yes | `Create` posts to `maintenanceWorkOrders`; `Update` sends PATCH to `maintenanceWorkOrders/{WorkOrderId}` |
| Work Order ID | Update only | Fusion maintenance work order resource ID. If empty, Update reads `msg.workOrderId` |
| Endpoint | Editor preview | Read-only endpoint preview based on selected SCM Server and Action |
| Payload Mappings | Yes | Structured rows mapping Fusion maintenance work order fields to values |

Create default mapping rows include `WorkOrderNumber`, `OrganizationCode`, `AssetNumber`, `MntWorkDefinitionCode`, `WorkOrderTypeCode`, `WorkOrderSubTypeCode`, `WorkOrderStatusCode`, `PlannedStartQuantity`, `PlannedStartDate`, `WorkOrderDescription`, `AllowCompletionToInventoryFlag`, `CompletionSubinventoryCode`, `AllowOutOfSequenceOperationCompletionFlag`, and `ExplosionFlag`. Update default rows include `WorkOrderDescription`, `WorkOrderStatusCode`, `WorkOrderPriority`, `PlannedStartDate`, `PlannedCompletionDate`, `AllowCompletionToInventoryFlag`, `CompletionSubinventoryCode`, and `AllowOutOfSequenceOperationCompletionFlag`. Preset row values start blank and non-static so users can choose the correct source type and path. Required create fields depend on the Fusion Maintenance setup.

**Inputs (runtime overrides):** `msg.action` overrides the configured Action with `create` or `update`; `msg.workOrderId` supplies the resource ID for Update. Mapping rows can read from `msg.payload`, `msg.dequeued`, any message property path, typed static values including `static JSON`, or the current timestamp.

**Outputs:** `msg.payload` (API response), `msg.maintenanceWorkOrder` (same successful API response), `msg.statusCode`, `msg.error` (on failure, object: `{ message, code }`)

This node manages the maintenance work order header resource. Use `maintenance-work-order-child` for operations, materials, resources, and cost-impacting maintenance operation transactions.

### maintenance-work-order-child

Manages maintenance work order child records and cost-impacting maintenance operation transactions.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Resource | Yes | Operation, Material, Resource, or Cost Transaction |
| Action | Yes | Child collections support Create, List, Get, Update, and Delete where Fusion supports them; Cost Transaction supports Create only |
| Work Order ID | Resource-dependent | Fusion maintenance work order resource ID. If empty, reads `msg.workOrderId` |
| Operation ID | Material/Resource | Fusion operation resource ID. If empty, reads `msg.operationId` |
| Child ID | Get/Update/Delete | Operation, material, or resource child record ID. If empty, reads `msg.childRecordId` |
| Endpoint | Editor preview | Read-only endpoint preview based on selected SCM Server, Resource, and Action |
| Payload Mappings | Create/Update | Structured rows mapping Fusion child-resource or maintenance operation transaction fields to values |

Resource modes target these Fusion resources:

| Resource | Endpoint pattern |
|----------|------------------|
| Operation | `maintenanceWorkOrders/{WorkOrderId}/child/WorkOrderOperation` |
| Material | `maintenanceWorkOrders/{WorkOrderId}/child/WorkOrderOperation/{WoOperationId}/child/WorkOrderOperationMaterial` |
| Resource | `maintenanceWorkOrders/{WorkOrderId}/child/WorkOrderOperation/{WoOperationId}/child/WorkOrderOperationResource` |
| Cost Transaction | `maintenanceOperationTransactions` |

Operation presets include `OperationSequenceNumber`, `OperationName`, `OperationDescription`, `WorkCenterCode`, `CountPointOperationFlag`, `AutoTransactFlag`, `PlannedStartDate`, and `PlannedCompletionDate`. Cost Transaction presets default to `OperationTransactionDetail` with `static JSON` so a nested maintenance operation transaction detail array can be supplied directly; enter the array value only, not an object that wraps `OperationTransactionDetail` again.

**Inputs (runtime overrides):** `msg.resource` overrides the configured Resource; `msg.action` overrides the configured Action; `msg.workOrderId`, `msg.operationId`, and `msg.childRecordId` supply IDs when editor fields are blank. Mapping rows can read from `msg.payload`, `msg.dequeued`, any message property path, typed static values including `static JSON`, or the current timestamp.

**Outputs:** `msg.payload` (API response), `msg.maintenanceWorkOrderChild` (same successful API response), `msg.workOrderChild` (same successful API response), `msg.statusCode`, `msg.error` (on failure, object: `{ message, code }`)

### create-asset / create-meter-reading / misc-transaction / subinventory-quantity-transfer

Individual SCM transaction nodes. Each targets a specific REST endpoint.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Mode | `misc-transaction` only | Custom, Miscellaneous Receipt, or Miscellaneous Issue. Receipt/Issue modes set `TransactionTypeName`; Custom leaves mapped fields unchanged |
| Payload Mappings | Yes | Structured rows mapping SCM fields to values |

For `misc-transaction`, `msg.mode` can override the configured Mode with `custom`, `receipt`, or `issue`. Receipt and Issue modes set `TransactionTypeName`, so their preset mappings omit that field and use `OrganizationId` for the staged transaction organization. They do not alter `TransactionQuantity`; map the positive or negative quantity required by the Fusion transaction setup. `misc-transaction` and `subinventory-quantity-transfer` include a `serials` mapping row for serialized inventory transactions. `subinventory-quantity-transfer` presets include `SubinventoryCode` for the source subinventory and `TransferSubinventory` for the destination.

**Outputs:** `msg.payload` (API response), `msg.statusCode`, `msg.error` (on failure, object: `{ message, code }`)
These typed nodes always call their canonical SCM endpoint. To target a different endpoint, use `fusion-request` with `Transaction Type = custom`.

### delete-transaction

Deletes an SCM resource by identifier using the selected mode endpoint.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Delete Type | Yes | Asset, Meter, Misc, Subinventory, or Custom |
| Resource ID | No | If empty, reads from `msg.resourceId` |
| Custom Endpoint | Custom only | Editable base endpoint URL used when Delete Type is `custom` (query string not allowed) |
| Endpoint | Editor preview | Read-only endpoint preview based on selected Delete Type and SCM Server |

New nodes default to `Delete Type = Custom` so the workspace label stays `delete transaction` until a delete type is selected.

**Inputs (runtime overrides):** `msg.resourceId` overrides the Resource ID field; `msg.mode` overrides the Delete Type (`asset`, `meter`, `misc`, `subinventory`, `custom`)

In custom mode, the node uses the configured Custom Endpoint as the base endpoint. Query parameters in Custom Endpoint are rejected. The resource ID is URL-encoded before path append, and delete requests time out after 30 seconds.

### get-ib-asset / get-meter-reading / get-organization-id

Individual SCM lookup nodes. Each queries a specific REST endpoint.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Query field (varies) | Yes | Serial Number, Asset Number, or Organization Name depending on node |
| Endpoint | Editor preview | Read-only endpoint preview based on selected SCM Server |

**Inputs (runtime overrides):** `msg.serialNumber` / `msg.assetNumber` / `msg.organizationName` overrides the respective query field

**Outputs:** `msg.payload` (API response), `msg.statusCode`, `msg.error` (on failure, object: `{ message, code }`)

Each node targets a fixed SCM endpoint. To query a different endpoint or use a custom query parameter, use `scm-lookup` in custom mode instead.

---

## OCI Nodes

OCI, IoT REST, and ORDS action nodes keep their normal output success-only. On Catch-path failures, they set `msg.error` to `{ message, code }`; when OCI SDK or ORDS responses include server-side detail text, that text is promoted into `msg.error.message`, `node.error(...)`, and `done(err).message`. OCI/ORDS failures keep raw response bodies in `msg.payload` when available and add `msg.opcRequestId` when the upstream request ID is available.

### oci-config (Config Node)

Shared authentication for all OCI REST API nodes. Uses the OCI SDK for TypeScript and JavaScript.

| Field | Required | Description |
|-------|----------|-------------|
| Name | No | Optional display name shown in config selectors and node labels |
| Auth Type | Yes | Config File, Instance Principal, Resource Principal, or API Key |
| Config File Path | Config File only | Path to OCI config file (default: `~/.oci/config`) |
| Profile | Config File only | Profile name (default: `DEFAULT`) |
| Tenancy OCID | API Key only | OCI tenancy identifier, for example `<tenancy-ocid>` |
| User OCID | API Key only | OCI user identifier, for example `<user-ocid>` |
| Fingerprint | API Key only | API key fingerprint |
| Private Key Path | API Key only | Path to PEM private key file |
| Passphrase | API Key only | Private key passphrase (optional) |
| Region | Yes | OCI region (e.g. `us-ashburn-1`) |
| Compartment OCID | No | Default compartment for child nodes |
| Test Connection | — | Calls `listRegions()` to verify credentials |

> **Note:** Instance Principal and Resource Principal only work inside OCI. Config File and API Key work from any machine.

### ords-config (Config Node)

Shared ORDS OAuth settings for ORDS HTTP request and polling nodes.

| Field | Required | Description |
|-------|----------|-------------|
| Name | No | Optional display name shown in config selectors |
| Base URL | Yes | ORDS base URL; child nodes append relative paths such as `/20250531/rawCommandData` |
| Client ID | Yes | OAuth client ID stored in Node-RED credentials |
| Client Secret | Yes | OAuth client secret stored in Node-RED credentials |
| Token URL | Yes | OAuth token endpoint URL. Must use HTTPS |
| Scope | No | Optional OAuth scope. Leave blank for ORDS token endpoints that only require `grant_type=client_credentials` |
| Request Timeout (ms) | No | Timeout for token and ORDS HTTP requests. Default: `30000` |
| Fallback Expiry (min) | No | Token cache duration when `expires_in` is absent. Default: `60` |
| Max Concurrent Polls | No | Maximum active `oci-ords-poll` jobs for this config. Regular ORDS request nodes ignore this setting. Default: `5` |
| Max Queued Polls | No | Maximum waiting `oci-ords-poll` jobs for this config. New polling jobs fail fast when the queue is full. Default: `100` |

`ords-config` caches OAuth access tokens, refreshes once after a 401 ORDS response, merges headers case-insensitively, rejects reserved object keys in header/query maps, and aborts active ORDS fetches when the config node closes.

### oci-ords-request

Sends a one-shot ORDS HTTP request using an `ords-config` OAuth token. The node defaults to Custom relative paths and provides IoT Data API endpoint presets as shortcuts.

| Field | Required | Description |
|-------|----------|-------------|
| ORDS Config | Yes | References an `ords-config` node |
| Operation | Yes | Custom (default), Raw Command Data, Raw Data, Rejected Data, Snapshot Data, or Historized Data |
| Method | Yes | HTTP method. IoT Data API presets normally use `GET` |
| Record ID | No | Optional path segment appended to the selected endpoint. If empty, reads from `msg.recordId` |
| Query JSON | No | Optional ORDS `q` filter. Can be overridden by `msg.query` |
| Headers JSON | No | Optional request headers. Can be extended or overridden by `msg.headers` |
| Body JSON | No | Optional JSON request body for configured body-capable methods. Hidden for configured `GET`/`HEAD`; if a runtime `msg.method` override changes a no-body configured method to a body-capable method, the node uses `msg.payload` |
| Custom Path | Custom only | Relative ORDS path used when Operation is `Custom` |

**Runtime overrides:** `msg.operation`, `msg.method`, `msg.recordId`, `msg.query`, `msg.queryParams`, `msg.headers`, `msg.customPath`

**Outputs:** `msg.payload`, `msg.statusCode`, `msg.ordsUrl`, `msg.ordsOperation`, `msg.responseHeaders`, `msg.error` (on failure, object: `{ message, code }`)

### oci-ords-poll

Polls an ORDS endpoint until command status or a custom stop condition is reached.

| Field | Required | Description |
|-------|----------|-------------|
| ORDS Config | Yes | References an `ords-config` node |
| Poll Type | Yes | `Command Status` or `Custom` |
| Record ID | Command Status | Raw Command Data record ID. If empty, reads from `msg.recordId` |
| Wait For | Command Status | Terminal Status, `COMPLETED` Status, or Response Data. Delivery fields can be returned as a direct row or as the first item in an ORDS collection response |
| Custom Path | Custom only | Relative ORDS path to poll |
| Success Property | Custom only | Dot-notation response property checked for completion |
| Success Mode | Custom only | Not Empty, Exists, or Equals |
| Success Value | Equals only | Expected value for Equals mode |
| Query JSON | No | Optional ORDS `q` filter. Can be overridden by `msg.query` |
| Interval (ms) | No | Delay between attempts. Default: `2000` |
| Timeout (ms) | No | Maximum wait time. Default: `60000` |

**Runtime overrides:** `msg.recordId`, `msg.customPath`, `msg.query`, `msg.queryParams`, `msg.intervalMs`, `msg.timeoutMs`

**Outputs:** `msg.payload`, `msg.statusCode`, `msg.ordsUrl`, `msg.pollComplete`, `msg.pollTimedOut`, `msg.pollAttempts`, `msg.deliveryStatus`, `msg.responseHeaders`, `msg.error` (on failure, object: `{ message, code }`)

### oci-notification

Publishes messages to an OCI Notifications topic.

| Field | Required | Description |
|-------|----------|-------------|
| OCI Config | Yes | References an oci-config node |
| Topic OCID | No* | Notification topic OCID. *Required either here or via `msg.topicOcid` |
| Title | No | Message title (email subject). Overridden by `msg.title` |
| Body | No | Message body. Falls back to `msg.payload` (objects are JSON-stringified) |

**Inputs (runtime overrides):** `msg.topicOcid` overrides the configured Topic OCID; `msg.title` overrides the configured Title

**Outputs:** `msg.payload` (publish result with `messageId`), `msg.statusCode`, `msg.error` (on failure, object: `{ message, code }`)

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

**Outputs:** `msg.payload.opcRequestId`, `msg.payload.statusCode`, `msg.statusCode`, `msg.error` (on failure, object: `{ message, code }`)

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

**Outputs:** `msg.payload.statusCode`, `msg.payload.requestId`, `msg.statusCode`, `msg.error` (on failure, object: `{ message, code }`)

### iot-config (Config Node)

MQTT connection to the OCI IoT Platform. Manages persistent sessions, command subscriptions, and auto-reconnect.

| Field | Required | Description |
|-------|----------|-------------|
| Name | No | Optional display name shown in config selectors and node labels |
| Device Host | Yes | MQTT broker hostname from your IoT Domain |
| Client ID | Yes | MQTT client ID (typically the device/digital twin name) |
| Auth Type | Yes | Basic (username/password) or Certificate (mTLS) |
| Username | Basic only | Digital twin `external-key` |
| Password | Basic only | Vault secret content |
| CA Cert | Cert only | Path to CA certificate (usually not needed) |
| Client Cert | Cert only | Path to client certificate PEM |
| Client Key | Cert only | Path to client private key PEM |
| Clean Session | No | When enabled, starts a clean MQTT session. Default: disabled (`clean=false`) for persistent command/session behavior |
| Keep Alive | No | MQTT keepalive interval in seconds (15-300). Default: `60` |
| Reconnect Period | No | Auto-reconnect period in milliseconds (1000-60000). Default: `5000` |
| Connect Timeout | No | MQTT connect timeout in milliseconds (5000-120000). Default: `30000` |
| Test Connection | — | Creates a temporary MQTT connection to verify credentials |

By default, connects with `clean: false` (persistent session) so the IoT Platform retains messages during brief disconnections. Reconnect/keepalive/timeout values are configurable in the editor.
When advanced numeric fields are left empty, the editor/runtime default values are used. Out-of-range values are normalized to supported bounds.

> **Note:** The OCI IoT Platform only supports MQTTS on port 8883. Proxy connections are not supported.

### iot-telemetry

Publishes telemetry data to the IoT Platform via MQTT.

| Field | Required | Description |
|-------|----------|-------------|
| IoT Config | Yes | References an iot-config node |
| Topic | No | MQTT topic to publish to. Leave blank to use `msg.topic` at runtime |
| QoS | No | MQTT QoS level (0, 1, or 2). Can be overridden per message via `msg.qos`. Invalid runtime values fall back to configured QoS |
| Auto Timestamp | No | Adds `time` field (epoch microseconds) if not present. Default: disabled — prefer setting `time` at the device or upstream so it reflects sample time, not Node-RED receive time. |

**Input:** `msg.payload` (telemetry data), `msg.topic` (used when Topic field is blank), `msg.qos` (overrides configured QoS)

**Outputs:** `msg.payload` (passed through), `msg.topic` (MQTT topic published to)

### iot-subscribe

Subscribes to an OCI IoT MQTT topic and outputs a message whenever a matching MQTT message arrives. This node has **no input** — messages arrive from the broker.
Palette label: `subscribe`.

| Field | Required | Description |
|-------|----------|-------------|
| IoT Device | Yes | References an iot-config node for the MQTT connection |
| Topic | Yes | MQTT topic to subscribe to. Supports `#` (multi-level) and `+` (single-level) wildcards. `#` must be the final segment and `+` must occupy a full segment. Invalid patterns are rejected at startup |
| QoS | Yes | Subscription QoS level (0, 1, or 2) |

**Outputs:** `msg.payload` (JSON object or string — JSON is auto-detected), `msg.topicSuffix` (portion of the topic matched by `#`, or last segment for fixed topics), `msg.topic` (full received topic)

### iot-send-command

Sends commands to devices via the OCI REST API.

| Field | Required | Description |
|-------|----------|-------------|
| OCI Config | Yes | References an oci-config node (not iot-config — this uses the REST API) |
| Digital Twin OCID | No* | Device to send the command to. *Required either here or in `msg.digitalTwinOcid` |
| Request Endpoint | Yes | Exact endpoint/topic the device or gateway subscribes to. Can be overridden by `msg.requestEndpoint` |
| Wait for Response | No | Includes response endpoint so the platform waits for device ack. Default: enabled. |
| Response Endpoint | Response only | Exact endpoint/topic the device or gateway publishes responses to. Can be overridden by `msg.responseEndpoint` |
| Request Duration | No | ISO 8601 delivery timeout (default: `PT10M` = 10 minutes) |
| Response Duration | No | ISO 8601 ack timeout (default: `PT10M`) |

**Inputs:** `msg.payload` (command data to send to device), `msg.requestEndpoint`, `msg.responseEndpoint`

**Outputs:** `msg.payload` (API response), `msg.statusCode`, `msg.requestEndpoint`, `msg.responseEndpoint` (only when Wait for Response is enabled), `msg.commandStatusLocation` (OCI command status URL when returned), `msg.recordId` / `msg.rawCommandDataRecordId` (parsed Raw Command Data record ID when returned), `msg.opcRequestId`

`iot-send-command` sends the exact Request Endpoint and Response Endpoint values to OCI IoT instead of generating `/cmd/` and `/rsp/` paths. It validates endpoint presence and Request/Response Duration values before calling OCI, and rejects invalid ISO 8601 duration strings.
When OCI returns a command status location, the node parses the final path segment into `msg.recordId` so `oci-ords-poll` Command Status mode can use it directly.

### iot-get-content

Retrieves digital twin instance content from the OCI IoT REST API.

| Field | Required | Description |
|-------|----------|-------------|
| OCI Config | Yes | References an `oci-config` node for authentication/region |
| Digital Twin OCID | Yes* | Digital twin instance OCID. *Can be overridden by `msg.digitalTwinOcid` |
| Include Metadata | No | Includes metadata in the response when enabled. Can be overridden by `msg.shouldIncludeMetadata`. |

**Input:** `msg.digitalTwinOcid` (optional runtime override), `msg.shouldIncludeMetadata` (optional runtime override; boolean or true/false-like string)

**Outputs:** `msg.payload` (digital twin content object), `msg.statusCode`, `msg.etag`, `msg.opcRequestId`, `msg.digitalTwinOcid`, `msg.shouldIncludeMetadata`

### iot-update-relationship

Updates digital twin relationship content through the OCI IoT REST API.

| Field | Required | Description |
|-------|----------|-------------|
| OCI Config | Yes | References an `oci-config` node for authentication/region |
| IoT Domain ID | Yes* | IoT domain OCID. *Can be overridden by `msg.iotDomainId` |
| Default Relationship Key | No | Fallback used when runtime relationship key is not provided |
| Default Content | No | JSON object fallback used when runtime content is not provided |

**Input:**
- `msg.relationshipKey` (or `msg.payload.relationshipKey`) in format `sourceTwinOcid->targetTwinOcid:contentPath`
- `msg.content` (or `msg.payload.content`) object with relationship content updates
- `msg.iotDomainId` (optional runtime override)

**Outputs:**
- Success output: `msg.payload` (updated relationship), `msg.relationshipId`, `msg.relationshipKey`, `msg.statusCode`, `msg.operation`
- Errors: routed via Catch (`done(err)` + `node.error(...)`) with `msg.error` populated on the error message context

**Notes:**
- This node resolves `relationshipKey` to a relationship OCID before update.
- V1 intentionally supports relationship-content update only; full relationship CRUD is deferred.
- Runtime values take precedence over editor defaults:
  - `iotDomainId`: `msg.iotDomainId` -> editor field
  - `relationshipKey`: `msg.relationshipKey` -> `msg.payload.relationshipKey` -> Default Relationship Key
  - `content`: `msg.content` -> `msg.payload.content` -> Default Content

## SCM Payload Mappings

All SCM nodes that use payload mappings support structured mapping rows:

| Source | Reads from | Value field contains |
|--------|-----------|---------------------|
| **dequeued data** | `msg.dequeued.<value>` | Field name (e.g. `AssetNumber`) |
| **msg property** | `msg.<value>` | Full property path (e.g. `payload.someField`) |
| **static text** | Literal string | Constant text value (e.g. `NODE_RED`) |
| **static number** | Numeric literal | Constant number value (e.g. `1`) |
| **static boolean** | Boolean literal | Dropdown value: `true` or `false` |
| **static JSON** | Parsed JSON | JSON array/object/value for nested fields such as `serials` |
| **current timestamp** | Runtime clock | Leave blank; generated as an ISO timestamp at runtime |

`static JSON` values are parsed at runtime and routed to Catch if the editor value is blank or invalid JSON.

## Typical Flows

**Transactional dequeue → SCM create (with error handling):**
`begin transaction` → `dequeue` → `fusion-request` → `end transaction (commit)`
On error: `catch` → `end transaction (rollback)`

**IoT telemetry publishing:**
`inject` (repeat 10s) → `function` (build sensor payload) → `iot telemetry`

**IoT command round-trip:**
`inject` (command payload) → `iot send command` → `debug` (sent)
`subscribe` → `debug` (received on device-side subscription)

**IoT command status via ORDS:**
`iot send command` (outputs `msg.recordId`) → `oci ords poll` (Command Status) → `debug`

**IoT digital twin content read:**
`inject` (optional twin override) → `iot get content` → `debug`

**IoT relationship content update:**
`inject` (relationshipKey + content) → `iot update relationship` → `debug` (success/failure)

**Threshold monitoring with notification:**
`dequeue` → `switch` (temperature < 20?) → `iot send command` (shutdown) → `oci notification` (alert)

**SQL query:**
`inject` → `sql` → `debug`

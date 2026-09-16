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
| Username | Basic only | Authenticating database username. With proxy authentication, Oracle reports it as `PROXY_USER`; otherwise it is the session user. Existing `USERNAME[SESSION_USER]` values remain supported when Session User is blank. |
| Password | Basic only | Database password |
| TNS String | Yes | TNS alias or connect descriptor. When copying from `tnsnames.ora`, enter only the descriptor after `<alias> =`, not the complete assignment. |
| Wallet Directory | No | Extracted wallet directory, not a wallet ZIP or `tnsnames.ora` file. Set it when the connection requires wallet-based configuration. |
| Config File Location | Config File / Session Token | Path to OCI config file (default: `~/.oci/config`) |
| Profile | Config File / Session Token | Profile name in config file (default: `DEFAULT`) |
| Fingerprint | Simple only | API key fingerprint |
| Private Key Location | Simple only | Path to private key file |
| Passphrase | Simple only | Private key passphrase |
| Region ID | Simple only | OCI region |
| Tenancy OCID | Simple only | Tenancy OCID |
| User OCID | Simple only | User OCID |
| Session User | Basic / DB Token | Optional proxy target and effective schema reported by Oracle as `SESSION_USER`. With Basic auth, Username is the authenticating proxy user and the node composes Oracle's `USERNAME[SESSION_USER]` form. With DB Token auth, the IAM token identity authenticates. Supported in Thin and Thick modes with node-oracledb 7. |
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
| Test Database Connection | — | Verifies the deployed database connection. Requires a TNS String; configure one in the Connection tab before testing. |

Driver mode behavior:

| Behavior | Thick | Thin |
|----------|-------|------|
| Runtime scope | Process-wide after first DB connection initialization | Process-wide after first DB connection initialization |
| Basic / DB Token + Session User | Supported with node-oracledb 7 | Supported with node-oracledb 7 |
| Wallet Directory | Resolves a TNS alias from the directory's `tnsnames.ora` and applies the wallet to the descriptor | Supplies the network and wallet configuration directory to node-oracledb |

> **Important:** Node-oracledb mode is process-wide in a single Node-RED runtime. The first
> `db-connection` to initialize the driver sets the mode.
> Later nodes requesting a different mode continue using the initialized runtime mode and log a
> warning. Restart Node-RED to switch modes.
> In Thick mode, if `ORACLE_CLIENT_LIB` is set it is used as `libDir`; otherwise node-oracledb default platform library lookup is used.
> When using a Thick wallet connection, either enter an alias found in the configured Wallet Directory or enter a descriptor; the node applies the directory without changing the process-wide Oracle Client configuration.

### begin-transaction

Opens a managed database transaction and attaches a clone-safe runtime-local reference in `msg._dbTransaction`. The Oracle connection stays private to the runtime.

| Field | Required | Description |
|-------|----------|-------------|
| DB Connection | Yes | References a db-connection config node |
| Timeout (seconds) | No | Auto-rollback if end-transaction isn't reached within this time. Set to `0` for no timeout. |

**Outputs:** `msg._dbTransaction` (opaque reference to preserve unchanged). The non-enumerable `msg.transaction` exposes the local connection and lifecycle metadata where attached; cloning may omit it, and DB nodes recover it from the reference. Do not manually construct transaction contexts or use the live connection directly: those operations bypass managed coordination.

An active reference for the same DB Connection reuses the existing transaction. When Timeout is enabled, reuse refreshes the timeout window.
Status reports `connecting...` while opening a connection, then `transaction started` or `transaction reused`. A missing DB Connection uses a validation ring; a connection failure uses an execution-failure dot.

**Validation:** DB nodes reject unknown, timed-out, closing, or ended references with `DB_TRANSACTION_INACTIVE`. A reference used with a different DB Connection is rejected with `DB_TRANSACTION_CONFIG_MISMATCH`. Neither case starts standalone work. Messages with no transaction context retain standalone behavior. References do not survive runtime restarts or transfer to another process.

**Shutdown and timeout:** Stop new transaction work, wait for active DB work, then roll back and close once. Cleanup cannot interrupt a stuck database call. Use finite AQ waits and database/network execution limits; a pool acquisition timeout limits waiting for a connection, not SQL execution. Connections received after shutdown starts are closed without forwarding a message.

### end-transaction

Commits or rolls back the transaction connection and closes it. Shows elapsed time in status.

| Field | Required | Description |
|-------|----------|-------------|
| Action | Yes | **Commit** (default): commits all changes, dequeued messages are permanently removed. **Rollback**: rolls back all changes, dequeued messages return to the queue. |

**Commit** shows `committing...` followed by a status such as `committed (2.3s)`. **Rollback** shows `rolling back...` followed by a status such as `rolled back (2.3s)`. Commit and rollback failures remain visible as execution-failure statuses.

End stops admission of new DB work and waits for active work before finalizing once. A failed commit attempts rollback; a failed rollback is not repeated. Connection close is attempted in either case. External Fusion and OCI operations are not enlisted in the database transaction.
Once a DB node reports a processing error, that managed transaction can only roll back. If one insert succeeds and the next fails, Commit rolls back both rather than saving the first, and reports `DB_TRANSACTION_ROLLBACK_REQUIRED`. An invalid transaction reference does not mark a different transaction as failed.
Unknown, expired, closing or already-ended references report `inactive transaction` with `DB_TRANSACTION_INACTIVE` through Catch. Successful output removes `msg._dbTransaction` and `msg.transaction`.
If an imported flow provides an invalid Action value, the node logs a warning and defaults to commit behavior.

**Catch and branching:** Route processing errors through Catch to End configured for Rollback, preserving `msg._dbTransaction`. Keep End outside its own Catch scope. Wait for every transaction branch to finish before sending one message to End: a branch still in a Delay node may otherwise reach SQL after the transaction has closed. Do not log, publish, persist, or modify the reference. With neither reference nor private handle, End reports `no transaction` and passes through without DB work. Use a nonzero Begin timeout as a cleanup safeguard.

### dequeue

Dequeues messages from an Oracle AQ queue.

| Field | Required | Description |
|-------|----------|-------------|
| DB Connection | Yes | References a db-connection config node |
| Mode | No | **Transactional** (default): triggered by an incoming msg, supports begin/end-transaction. **Continuous**: auto-starts on deploy, long-polls with `AQ_DEQ_WAIT_FOREVER`, auto-commits after each batch — no rollback protection. |
| Enable Retries | Continuous only | Retry DB/dequeue errors in continuous mode (default: enabled). A missing Subscriber for a multi-consumer queue stops immediately. |
| Retry Delay (ms) | Continuous only | Fixed delay before each reconnect attempt (default: `5000`). |
| Max Retries | Continuous only | Maximum retry attempts after a failure. `0` means unlimited (default). |
| Queue Name | Yes | AQ queue name (e.g. `SCHEMA.JSON_QUEUE`) |
| Subscriber | Multi-consumer queues | Consumer name for multi-consumer queues. Leave empty only for single-consumer queues. |
| Payload Type | No | **JSON** (default): payload parsed as a JS object. **RAW**: payload as a `Buffer` (convert with `.toString()`). **ADT**: payload as a plain JS object converted from an Oracle DbObject — field names are uppercase. |
| Object Type | ADT only | Schema-qualified Oracle object type name (e.g. `ADMIN.MY_MSG_TYPE`) |
| Dequeue Mode | No | **Remove** (default): message is permanently removed on commit. **Browse**: message is read but stays in the queue. **Locked**: message is locked but stays in the queue on commit. |
| Block Indefinitely | No | Waits forever for messages if checked (Transactional mode only) |
| Blocking Time (seconds) | No | Wait time if not blocking indefinitely (Transactional mode only) |
| Batch Size | No | Messages per dequeue (default: 1, max: 10000) |

**Dequeue modes:**

| Mode | On dequeue | On commit | Use case |
|------|-----------|-----------|----------|
| **Remove** | Reads and marks for removal | Message permanently deleted | Normal message consumption |
| **Browse** | Reads without locking | Message stays, anyone can read it again | Monitoring or inspecting queue contents |
| **Locked** | Reads and locks | Lock released, message stays | Inspect before deciding to remove |

**Outputs:** `msg.payload` (message payload), `msg.dequeued` (same, for SCM payload mapping compatibility)

**Transactional mode:** When wired after begin-transaction, uses `msg.transaction.connection`. Messages stay locked on the queue until end-transaction commits or rolls back. The node reports `dequeuing...`, followed by `dequeued N` or `no messages`.

**Batch processing:** Each dequeued item is emitted as a separate message. In a managed transaction, every item shares the same transaction. Use Batch Size `1` for a direct processing-to-End path; larger batches require every item to finish before one End commits. The first Commit otherwise commits removal of the whole batch.

**Standalone mode:** When used without transaction nodes, creates its own connection and commits before emitting messages. Downstream failures cannot roll back that dequeue.

**Continuous mode:** Starts on deploy with no input trigger, then dequeues with `AQ_DEQ_WAIT_FOREVER`. A successful batch shows `dequeued N` for two seconds while the next blocking dequeue starts immediately, then restores the blue-ring `listening` status. On DB/dequeue errors, the node retries connection/dequeue automatically when retries are enabled and stops after Max Retries is exhausted. On redeploy/stop, the node interrupts the blocking dequeue call (and any retry wait) so close can finish promptly without timing out. If Oracle returns `ORA-25231`, configure **Subscriber** with the AQ consumer name required by the multi-consumer queue; this missing-subscriber error stops immediately.

### enqueue

Enqueues JSON, RAW, or ADT messages into an Oracle AQ queue.

| Field | Required | Description |
|-------|----------|-------------|
| DB Connection | Yes | References a db-connection config node |
| Queue Name | Yes | AQ queue name |
| Recipients | No | Comma-separated subscriber names applied to every enqueued message. Spaces around names are trimmed; case is preserved. Empty entries and control characters are rejected. Blank uses the queue's subscriptions. |
| Delivery Mode | No | **Persistent** (default): written to the queue table. **Buffered** requires immediate visibility and does not support JSON payloads; see the limitation below. |
| Payload Type | No | **JSON** (default): enqueues JS objects. **RAW**: enqueues strings as UTF-8 Buffers. **ADT**: instantiates Oracle DbObjects from JS objects using the configured object type. |
| Object Type | ADT only | Schema-qualified Oracle object type name (e.g. `ADMIN.MY_MSG_TYPE`) |
| User Payload | No | A single object or JSON array. A single object is enqueued as one message; each array element becomes a separate message. If empty, uses `msg.payload` (accepts both shapes). For JSON/ADT payload types, the editor provides a `...` JSON editor button. |
| Pass Message | No | When enabled (default), sends a msg after successful enqueue. Disable to use as a pure sink. |

**Outputs (when enabled):** `msg.count` (number of messages enqueued). All upstream `msg` properties are preserved.

**Buffered limitation:** The node uses `enqMany` without configuring immediate visibility. Buffered delivery may therefore fail with `ORA-25298`; Thin mode also does not support immediate visibility with `enqMany`. Use Persistent for the documented workflow. Switching to Thick mode alone does not configure visibility. See [node-oracledb AQ options](https://node-oracledb.readthedocs.io/en/latest/user_guide/aq.html#changing-aq-options).

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

Clicking **Done** saves the current Binds Mapping rows; reopening the node restores them.

**Outputs:** `msg.payload` remains an array of row objects (or an empty array for successful statements without rows). `msg.dbResult` contains `{ success, rowsReturned, rowsAffected }`; `rowsAffected` is `null` when Oracle does not report an affected-row count.

Before opening a DB connection, SQL placeholder parity is validated: named placeholders require object binds, positional placeholders require array binds, and missing bind values fail fast with status "binds mismatch".
SQL execution failures route to Catch with the Oracle message and error number in `msg.error`; SQL text and bind values are not copied into `msg.error`.
In SQL Source `Editor` mode, semicolon-chained multi-statement SQL is blocked before execute; a single statement is required (anonymous PL/SQL blocks remain allowed). Do not include the trailing `/` command used by SQLcl and SQL*Plus; a PL/SQL block should end with `END;`. If a standalone trailing `/` is present, the node identifies it separately and tells the user to remove it.

Successful SELECT queries show status `rows: N`, DML shows `affected: N`, and PL/SQL or DDL without a row count shows `completed`.

When `msg.transaction.connection` exists, the SQL executes on that shared transaction connection and preserves `msg.transaction` for downstream `end-transaction`.

> **Important:** This node uses `autoCommit: false`. Standalone DML statements (INSERT, UPDATE, DELETE) are not committed and will roll back when the standalone connection closes. Use a PL/SQL block with explicit `COMMIT` for standalone DML, or wire through begin/end transaction nodes.

## SCM Nodes

All SCM HTTP action/lookup/event nodes apply a 30-second outbound request timeout.

### scm-server (Config Node)

Stores the Fusion hostname, API version, OAuth credentials, and proxy settings. SCM HTTP nodes reference this config; `smo-transformer` transforms messages locally without it.

| Field | Required | Description |
|-------|----------|-------------|
| Name | No | Optional display name shown in config selectors and node labels |
| Client ID | Yes | OAuth client ID |
| Client Secret | Yes | OAuth client secret |
| Scope | Yes | Token scope |
| Token URL | Yes | OAuth token endpoint URL. Must use HTTPS — enforced at deploy time. |
| Hostname | Yes | Fusion hostname only, without `https://` or a path. |
| API Version | Yes | Fusion REST API version supplied for the environment. |
| REST Base | Read-only | Derived preview: `https://<fusion-host>/fscmRestApi/resources/<api-version>`. Resource paths are appended automatically. |
| Use Expiry Fallback | No | When enabled, uses the configured fallback lifetime when the token response omits `expires_in` |
| Expiry Fallback (min) | No | Token cache duration in minutes used when `expires_in` is absent. Default: `60`. Ignored when `expires_in` is present — server-reported lifetime minus a 30-second safety buffer is used instead. |
| Use Proxy | No | Enables proxy for outbound requests |
| Proxy URL | Proxy only | Proxy URL used by axios |
| Test SCM Connection | No | Acquires an OAuth token, then verifies that the configured Fusion REST host is reachable. Reports OAuth-only success as a partial failure. |

> **Deploy-time validation:** Hostname, API Version, Token URL, and Scope must all be valid before deploying. Hostname must not include a protocol or path, and the Token URL must use HTTPS.

Fusion SCM REST nodes keep their normal output success-only. Each failed input is reported once through `done(err)`, with normalized error fields `{ message, code }`. When Fusion returns a validation body, its detail text is used in the error message and `msg.payload` keeps the raw response body. Node-RED adds its standard Catch source metadata and preserves the prior normalized error in `msg._error`.

### fusion-request

Unified SCM transaction node. Supports multiple transaction types in a single interface.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Transaction Type | Yes | Create Asset, Create Meter Reading, Miscellaneous Transaction, Subinventory Transfer, or Custom |
| Method | Yes | HTTP method (GET, POST, PUT, PATCH, DELETE) |
| Media Type | Yes | ADF Resource Item, ADF Action, JSON, or ADF Batch. ADF Action and ADF Batch require `POST`; Batch also requires the exact configured API-version root |
| Custom Endpoint | Custom only | HTTPS endpoint at or below the configured SCM Server's exact `/fscmRestApi/resources/{api-version}` hierarchy |
| Payload Source | Yes | `Mapped fields` (default) builds request data from mappings. `Entire msg.payload` uses a validated copy of the complete input object and ignores, but retains, saved mappings |
| Payload Mappings | Mapped fields only | Structured rows mapping SCM fields to values. `GET` sends the selected payload source as query parameters; `POST`/`PUT`/`PATCH` sends it as the JSON body; `DELETE` does not send request data |

New nodes default to `Transaction Type = Custom` so the workspace label stays `fusion request` until a transaction type is selected.

**Inputs (runtime overrides):** `msg.method` overrides the configured HTTP method for this message (case-insensitive; e.g. `GET`, `PATCH`). With Payload Source set to `Entire msg.payload`, `msg.payload` must be a plain object; it becomes the complete query-parameter object for `GET` or request body for write methods.

**Outputs:** `msg.payload` (raw API response), `msg.statusCode`, `msg.error` (on failure, object: `{ message, code }`)

On success, the node status reflects the effective HTTP method: `read` for `GET`, `submitted` for `POST`, `updated` for `PUT` or `PATCH`, and `deleted` for `DELETE`. This does not alter the output message.

Custom requests are validated before OAuth token acquisition. The endpoint must use HTTPS, cannot contain credentials or a fragment, and must remain on the exact configured Fusion origin and API version. Redirects are not followed.

Use **ADF Resource Item** for resource collection/item operations, **ADF Action** for documented action requests, and **JSON** when the target SCM operation documents `application/json`. ADF Action accepts both `/action/{name}` URLs and Oracle's action-in-payload form on a resource URL, but always requires `POST`.

**ADF Batch** requires `POST` to the exact `/fscmRestApi/resources/{api-version}/` root. Build the request body by mapping the SCM field `parts` from a message property or static JSON. Each part requires a unique nonempty `id`, a relative SCM resource `path` with or without a leading slash, and one of `get`, `create`, `update`, `replace`, `delete`, or `invoke`. Before sending, slashless `get`, `create`, `update`, `replace`, and `delete` paths receive a leading slash in a copied request body; `invoke` paths and the incoming message remain unchanged. Create, update, and replace parts require an object `payload`. Invoke parts may omit `payload` for parameterless actions; when supplied, it must be an object. Absolute URLs, network-path references, path traversal, fragments, backslashes, invalid encoding, duplicate IDs, and unsupported operations are rejected before authentication.

Smart Operations JSON events remain the responsibility of `smo-event`; `fusion-request` Custom mode does not permit `/api/scm-core/operational-data/v1/events`.

### scm-lookup

Unified SCM lookup node. Supports multiple query types.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Lookup Type | Yes | Installed Base Asset, Meter Reading, Inventory Organization, Item, Subinventory, On-Hand Quantity, Work Definition, Recipe / Work Definition, Manufacturing Work Order, Batch / Manufacturing Work Order, Batch Operation by Sequence, Batch Material / Ingredient Line, Batch Resource Line, Batch Output Product Line, Batch Material Reservation Status, Maintenance Work Order, or Custom |
| Find by | Inventory Organization only | Queries by Organization Name, Organization Code, or Organization ID. The output remains the complete Fusion response. |
| Work Order ID | Manufacturing child lookups only | Fusion `WorkOrderId` resource key used in the child endpoint path. This is not the displayed work order or batch number. |
| Operation ID | Material, resource, output, and reservation child lookups only | Fusion `WorkOrderOperationId` resource key used in the nested child endpoint path. This is not the operation sequence. |
| Organization Code | Item, Subinventory, On-Hand Quantity, Work Definition/Recipe, Manufacturing Work Order/Batch, and Maintenance Work Order | Required organization scope for the selected lookup. |
| Item Number | Installed Base Asset and Work Definition/Recipe | Required second business key for the selected lookup. |
| Meter Code | Meter Reading only | Required meter identifier combined with Asset Number in the `MetersByAssetMeterUserKey` finder. |
| Subinventory Code | On-Hand Quantity only | Optional subinventory scope. |
| Query Value | Predefined lookups only | Primary value to search for (for example, Serial Number or Asset Number) |
| Additional Filters | Predefined lookups only | Optional JSON object sent as a separate REST `q` expression for extra narrowing. Field names may contain letters, numbers, underscores, and dots; values containing `;` are rejected. Dedicated fields take precedence over matching keys. |
| Custom Endpoint | Custom only | Complete Fusion GET URL or base resource endpoint. A pasted query string is normalized into Query Parameters. |
| Query Parameters | Custom only | Optional ordered name/value rows for top-level parameters such as `finder`, `q`, `fields`, `limit`, and `offset`. Repeated names are preserved. |
| Endpoint | Editor preview | Read-only preview of the complete request URL |

Prerequisite lookup types target `inventoryOrganizations` by the selected organization field, `itemsV2` by Item Number and Organization Code, `subinventories` by Subinventory Code and Organization Code, `inventoryOnhandBalances` by Item Number and Organization Code, `workDefinitions` by Work Definition Name, Organization Code, and Item Number, manufacturing `workOrders` by Work Order Number and Organization Code, and `maintenanceWorkOrders` by Work Order Number and Organization Code. Installed Base Asset uses Serial Number and Item Number. Meter Reading uses the `MetersByAssetMeterUserKey` finder with Asset Number and Meter Code and returns the complete matching history. Redwood aliases map to the same resources: Recipe maps to Work Definition, and Batch maps to Manufacturing Work Order.

Manufacturing child lookups target:

| Lookup Type | Required resource IDs | Endpoint pattern | Query field |
|-------------|-----------------------|------------------|-------------|
| Batch Operation by Sequence | Work Order ID | `workOrders/{WorkOrderId}/child/WorkOrderOperation` | `OperationSequenceNumber` |
| Batch Material / Ingredient Line | Work Order ID, Operation ID | `workOrders/{WorkOrderId}/child/WorkOrderOperation/{WorkOrderOperationId}/child/WorkOrderOperationMaterial` | `InventoryItemNumber` |
| Batch Resource Line | Work Order ID, Operation ID | `workOrders/{WorkOrderId}/child/WorkOrderOperation/{WorkOrderOperationId}/child/WorkOrderOperationResource` | `ResourceCode` |
| Batch Output Product Line | Work Order ID, Operation ID | `workOrders/{WorkOrderId}/child/WorkOrderOperation/{WorkOrderOperationId}/child/WorkOrderOperationOutput` | `InventoryItemNumber` |
| Batch Material Reservation Status | Work Order ID, Operation ID | `workOrders/{WorkOrderId}/child/WorkOrderOperation/{WorkOrderOperationId}/child/WorkOrderOperationMaterial` | `InventoryItemNumber` |

To navigate manufacturing children, first look up the Batch / Manufacturing Work Order by its document number and copy the response `WorkOrderId` into **Work Order ID**. For nested material, resource, output, or reservation lookups, look up the operation by sequence and copy its response `WorkOrderOperationId` into **Operation ID**.

In custom mode, paste a complete Fusion GET URL or enter a base resource
endpoint and add zero or more **Query Parameters**. The editor decodes a pasted
query string once, moves every entry into ordered editable rows, and encodes the
rows once when rebuilding the URL. This works consistently for `q`, `finder`,
paging, field selection, boolean flags, empty values, and repeated parameter
names. A parameterless Custom GET is valid.

Custom Endpoint must use HTTPS, cannot contain credentials or a fragment, and
must remain at or below the configured SCM Server's exact
`/fscmRestApi/resources/{api-version}` root. Custom requests do not follow
redirects. Query Parameters are static node configuration; use `fusion-request`
GET mappings when parameter values must come from each incoming message.

Meter Reading mode follows every Fusion collection page. For a multi-page
history, the output is normalized: `items` and `count` cover all readings,
`hasMore` is `false`, `offset` is `0`, `limit` remains Fusion's page size, and
page-specific `links` are omitted.

Primary Query Values and Additional Filter values containing `;` are rejected because Fusion uses semicolons to separate `q` filter expressions.

New nodes default to `Lookup Type = Custom` so the workspace label stays `scm lookup` until a lookup type is selected.

**Inputs (runtime overrides):** for predefined lookups, `msg.queryValue` overrides the Query Value field; `msg.organizationCode`, `msg.itemNumber`, `msg.meterCode`, and `msg.subinventoryCode` override their dedicated lookup fields; `msg.queryFilters` overrides Additional Filters as an object or JSON object string; `msg.workOrderId` overrides Work Order ID for manufacturing child lookups; `msg.workOrderOperationId` overrides Operation ID for material/resource/output/reservation lookups. Custom Endpoint and Query Parameters are static configuration.

**Outputs:** `msg.payload` (API response), `msg.statusCode`, `msg.error` (on failure, object: `{ message, code }`)

Successful lookup requests that return an empty Fusion collection (`items: []`) still pass the response downstream, but the node status shows `not found` instead of `found`.

### smo-transformer

Transforms incoming telemetry or message data into structured Smart Operations event payloads for Oracle Fusion Cloud.

Palette label: `smart operations transformer`.

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
| Stale Timeout (seconds) | No | How long the timer waits before emitting incomplete composite data and removing it from pending storage. `0` uses Max Pending Age; it does not disable the timer. |
| Max Pending Composites | No | Upper bound for pending composite entries in memory (default `1000`) |
| Max Pending Age (seconds) | No | Upper bound for how long a pending composite entry may stay in memory (default `3600`) |
| JSONata Override | No | Replaces all field mapping configuration |

**Inputs:** `msg.payload` must be a single object. Arrays and non-object payloads raise an error and can be routed to a Catch node.

**Outputs:** `msg.smoEvent` (structured Smart Operations event object, default) or `msg.payload` when Output Target is set to `msg.payload`.

A complete event replaces pending partial data for the same entity, event time, and event type, and cancels that entry's timer. For an incomplete event receiving no further data, Stale Timeout `0` with Max Pending Age `60` emits the partial data after about 60 seconds and removes the pending entry.

New nodes start with `Select event type...`, empty mappings, and the generic `smart operations transformer` workspace label. Select a preset to populate its default mappings, or add a custom event type. Messages are routed to Catch if Event Type is left blank.

Clicking **Done** persists custom event types, entity/event-time fields, field mappings, and composite required/split fields so the same configuration is restored when the editor reopens.

The preview panel applies mapping, split field, collect-flat, value-map, nesting, and event-time settings to the sample payload. In Composite mode, array samples simulate fragment grouping by `entityCode`, `eventTime`, and `eventTypeCode`, then show merged outputs, pending fragments, and fragment-level errors. Sample payloads populate path suggestions and preview output; they do not validate whether configured paths are valid because production payloads may use aliases or variants that are not present in the pasted samples. Preview is unavailable while JSONata Override is set because JSONata is evaluated by the Node-RED runtime.

When Composite is enabled and a message is incomplete, `entityCode` and `eventTime` must both be present to build a stable composite key. Missing key parts fail fast instead of using shared fallback keys.

Successful transformations report `transformed`. Incomplete composite entries report `waiting: <key>` until they complete or expire. Validation failures use ring statuses, while JSONata and other execution failures report `transform failed`, populate `msg.error`, and route an `Error` through Catch. An older composite-expiry timer cannot clear a newer waiting, success, or error status.

### smo-event

Sends structured Smart Operations operational events to Oracle Fusion Cloud SCM.

Palette label: `smart operations event`.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Entity Code | No | Optional fallback when `msg.entityCode`, `msg.smoEvent.entityCode`, and `msg.payload.entityCode` are absent |
| Event Type Code | No | Optional fallback when `msg.eventTypeCode`, `msg.smoEvent.eventTypeCode`, and `msg.payload.eventTypeCode` are absent |
| Default Time | No | Uses the current ISO timestamp when `eventTime` is missing |
| Endpoint | Editor preview | Read-only preview of the Smart Operations events endpoint |

**Inputs:** `msg.smoEvent` or `msg.payload` should contain `{ entityCode, eventTypeCode, eventTime, data }`. Runtime overrides `msg.entityCode`, `msg.eventTypeCode`, `msg.eventTime`, and `msg.data` take precedence over the structured event fields.

**Outputs:** `msg.payload` (raw API response), `msg.statusCode`, `msg.smoEvent` (submitted event body), `msg.error` (on failure, object: `{ message, code }`)

A successful request sets the node status to `submitted`. This confirms that Fusion received the request, not that downstream Smart Operations processing accepted the event. Fusion can return an empty response body, in which case `msg.payload` is the empty string while `msg.statusCode` and `msg.smoEvent` provide the submission details.

Use `smo-transformer` upstream to convert raw telemetry, camera, PLC, scanner, or MQTT payloads into the event shape before sending.

### manufacturing-work-order

Creates or updates a discrete manufacturing work order header in Oracle Fusion SCM.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Action | Yes | `Create` posts to `workOrders`; `Update` sends PATCH to `workOrders/{WorkOrderId}` |
| Work Order ID | Update only | Fusion work order resource ID. If empty, Update reads `msg.workOrderId` |
| Endpoint | Editor preview | Read-only endpoint preview based on selected SCM Server and Action |
| Payload Source | Yes | `Mapped fields` (default) builds the work order from mappings. `Entire msg.payload` uses a validated copy of the complete input object and ignores, but retains, saved mappings |
| Payload Mappings | Mapped fields only | Structured rows mapping Fusion work order fields to values |

Create default mapping rows include `WorkOrderNumber`, `OrganizationCode`, `ItemNumber`, `WorkDefinitionCode`, `WorkOrderStatusCode`, `WorkOrderTypeCode`, `PlannedStartQuantity`, `PlannedStartDate`, `PlannedCompletionDate`, `ExplosionFlag`, and `WorkOrderDescription`. Dynamic values default to `msg.payload.*`; status and explosion use typed constants, and the start date uses the current timestamp. `WorkDefinitionName` is read-only for create requests and is rejected before the API call. Update defaults read values from `msg.payload.*`. Required create fields depend on the Fusion Manufacturing setup.

**Inputs (runtime overrides):** `msg.action` overrides the configured Action with `create` or `update`; `msg.workOrderId` supplies the resource ID for Update. Mapping rows can read from `msg.payload`, `msg.dequeued`, any message property path, typed static values including `static JSON`, or the current timestamp. In Entire msg.payload mode, `msg.payload` is the complete work order object.

**Outputs:** `msg.payload` (API response), `msg.manufacturingWorkOrder` (same successful API response), `msg.statusCode`, `msg.error` (on failure, object: `{ message, code }`)

This node manages the work order header resource. Use `manufacturing-work-order-child` for operations, components, resources, serials, and progress/quantity reporting.

### manufacturing-work-order-child

Manages manufacturing work order child records and operation progress transactions.

Palette label: `manage manufacturing work order details`.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Resource | Yes | Operation, Component, Resource, Serial, or Progress |
| Action | Yes | Child collections support Create, List, Get, Update, and Delete where Fusion supports them; Progress supports Create only |
| Work Order ID | Resource-dependent | Fusion manufacturing work order resource ID. If empty, reads `msg.workOrderId` |
| Operation ID | Component/Resource | Fusion operation resource ID. If empty, reads `msg.operationId` |
| Child ID | Get/Update/Delete | Operation, component, resource, or serial child record ID. If empty, reads `msg.childRecordId` |
| Endpoint | Editor preview | Read-only endpoint preview based on selected SCM Server, Resource, and Action |
| Payload Source | Create/Update | `Mapped fields` (default) builds the child request from mappings. `Entire msg.payload` uses a validated copy of the complete input object and ignores, but retains, saved mappings |
| Payload Mappings | Create/Update with Mapped fields | Structured rows mapping Fusion child-resource or operation-transaction fields to values |

Resource modes target these Fusion resources:

| Resource | Endpoint pattern |
|----------|------------------|
| Operation | `workOrders/{WorkOrderId}/child/WorkOrderOperation` |
| Component | `workOrders/{WorkOrderId}/child/WorkOrderOperation/{WorkOrderOperationId}/child/WorkOrderOperationMaterial` |
| Resource | `workOrders/{WorkOrderId}/child/WorkOrderOperation/{WorkOrderOperationId}/child/WorkOrderOperationResource` |
| Serial | `workOrders/{WorkOrderId}/child/WorkOrderSerialNumber` |
| Progress | `operationTransactions` |

Operation presets include `OperationSequenceNumber`, `OperationName`, `OperationDescription`, `WorkCenterCode`, `CountPointOperationFlag`, `AutoTransactFlag`, `PlannedStartDate`, and `PlannedCompletionDate`, read from matching `msg.payload.*` paths. Progress transactions read the nested `OperationTransactionDetail` collection from `msg.payload.OperationTransactionDetail` by default.

**Inputs (runtime overrides):** `msg.resource` overrides the configured Resource; `msg.action` overrides the configured Action; `msg.workOrderId`, `msg.operationId`, and `msg.childRecordId` supply IDs when editor fields are blank. Mapping rows can read from `msg.payload`, `msg.dequeued`, any message property path, typed static values including `static JSON`, or the current timestamp. In Entire msg.payload mode, `msg.payload` is the complete Create or Update body. List, Get, and Delete do not send it.

**Outputs:** `msg.payload` (API response), `msg.manufacturingWorkOrderChild` (same successful API response), `msg.workOrderChild` (same successful API response), `msg.statusCode`, `msg.error` (on failure, object: `{ message, code }`)

### manufacturing-production-transaction

Posts Fusion Manufacturing production reporting transactions for batches/work orders. Redwood UI terms map to the same REST model: Batches are manufacturing work orders, ingredients are operation materials, and output products are product completion transactions.

Palette label: `manufacturing production transaction`.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Mode | Yes | Operation Complete, Operation Reject, Operation Scrap, Operation Reverse to Ready, Material / Ingredient Issue, Material / Ingredient Return, Output Product Complete, or Output Product Return |
| Endpoint | Editor preview | Read-only endpoint preview based on selected SCM Server and Mode |
| Payload Source | Yes | `Mapped fields` (default) builds the logical transaction detail from mappings. `Entire msg.payload` uses a validated copy of the complete input object and ignores, but retains, saved mappings |
| Payload Mappings | Mapped fields only | Structured rows mapping Fusion production transaction detail fields to values |

Operation modes post to `operationTransactions` and wrap the selected logical detail in `OperationTransactionDetail`. Material and output modes post to `materialTransactions` and wrap it in `MaterialTransactionDetail`. Mode defaults and wrappers apply in both payload-source modes.

Mode defaults:

| Mode | Defaults |
|------|----------|
| Operation Complete | `FromDispatchState=READY`, `ToDispatchState=COMPLETE` |
| Operation Reject | `FromDispatchState=READY`, `ToDispatchState=REJECT` |
| Operation Scrap | `FromDispatchState=READY`, `ToDispatchState=SCRAP` |
| Operation Reverse to Ready | `FromDispatchState=COMPLETE`, `ToDispatchState=READY` |
| Material / Ingredient Issue | `TransactionTypeCode=MATERIAL_ISSUE` |
| Material / Ingredient Return | `TransactionTypeCode=MATERIAL_RETURN` |
| Output Product Complete | `TransactionTypeCode=PRODUCT_COMPLETION`, `OutputTypeCode=PRODUCT` |
| Output Product Return | `TransactionTypeCode=PRODUCT_RETURN`, `OutputTypeCode=PRODUCT` |

**Inputs (runtime overrides):** `msg.mode` overrides the configured Mode for this message. Mapping rows can read from `msg.payload`, `msg.dequeued`, any message property path, typed static values including `static JSON`, or the current timestamp. In Entire msg.payload mode, `msg.payload` is the complete logical transaction detail before the node applies mode defaults and the required Fusion wrapper.

**Outputs:** `msg.payload` (API response), `msg.manufacturingProductionTransaction` (same successful API response), `msg.statusCode`, `msg.error` (on failure, object: `{ message, code }`)

### maintenance-work-order

Creates or updates a maintenance work order header in Oracle Fusion SCM.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Action | Yes | `Create` posts to `maintenanceWorkOrders`; `Update` sends PATCH to `maintenanceWorkOrders/{WorkOrderId}` |
| Work Order ID | Update only | Fusion maintenance work order resource ID. If empty, Update reads `msg.workOrderId` |
| Endpoint | Editor preview | Read-only endpoint preview based on selected SCM Server and Action |
| Payload Source | Yes | `Mapped fields` (default) builds the work order from mappings. `Entire msg.payload` uses a validated copy of the complete input object and ignores, but retains, saved mappings |
| Payload Mappings | Mapped fields only | Structured rows mapping Fusion maintenance work order fields to values |

Create default mapping rows include `WorkOrderNumber`, `OrganizationCode`, `AssetNumber`, `MntWorkDefinitionCode`, `WorkOrderTypeCode`, `WorkOrderSubTypeCode`, `WorkOrderStatusCode`, `PlannedStartQuantity`, `PlannedStartDate`, `WorkOrderDescription`, `AllowCompletionToInventoryFlag`, `CompletionSubinventoryCode`, `AllowOutOfSequenceOperationCompletionFlag`, and `ExplosionFlag`. Dynamic values default to `msg.payload.*`; status and explosion use typed constants, and the start date uses the current timestamp. Update defaults read values from `msg.payload.*`. Required create fields depend on the Fusion Maintenance setup.

**Inputs (runtime overrides):** `msg.action` overrides the configured Action with `create` or `update`; `msg.workOrderId` supplies the resource ID for Update. Mapping rows can read from `msg.payload`, `msg.dequeued`, any message property path, typed static values including `static JSON`, or the current timestamp. In Entire msg.payload mode, `msg.payload` is the complete maintenance work order object.

**Outputs:** `msg.payload` (API response), `msg.maintenanceWorkOrder` (same successful API response), `msg.statusCode`, `msg.error` (on failure, object: `{ message, code }`)

This node manages the maintenance work order header resource. Use `maintenance-work-order-child` for operations, materials, resources, and cost-impacting maintenance operation transactions.

### maintenance-work-order-child

Manages maintenance work order child records and cost-impacting maintenance operation transactions.

Palette label: `manage maintenance work order details`.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Resource | Yes | Operation, Material, Resource, or Cost Transaction |
| Action | Yes | Child collections support Create, List, Get, Update, and Delete where Fusion supports them; Cost Transaction supports Create only |
| Work Order ID | Resource-dependent | Fusion maintenance work order resource ID. If empty, reads `msg.workOrderId` |
| Operation ID | Material/Resource | Fusion operation resource ID. If empty, reads `msg.operationId` |
| Child ID | Get/Update/Delete | Operation, material, or resource child record ID. If empty, reads `msg.childRecordId` |
| Endpoint | Editor preview | Read-only endpoint preview based on selected SCM Server, Resource, and Action |
| Payload Source | Create/Update | `Mapped fields` (default) builds the child request from mappings. `Entire msg.payload` uses a validated copy of the complete input object and ignores, but retains, saved mappings |
| Payload Mappings | Create/Update with Mapped fields | Structured rows mapping Fusion child-resource or maintenance operation transaction fields to values |

Resource modes target these Fusion resources:

| Resource | Endpoint pattern |
|----------|------------------|
| Operation | `maintenanceWorkOrders/{WorkOrderId}/child/WorkOrderOperation` |
| Material | `maintenanceWorkOrders/{WorkOrderId}/child/WorkOrderOperation/{WoOperationId}/child/WorkOrderOperationMaterial` |
| Resource | `maintenanceWorkOrders/{WorkOrderId}/child/WorkOrderOperation/{WoOperationId}/child/WorkOrderOperationResource` |
| Cost Transaction | `maintenanceOperationTransactions` |

Operation presets include `OperationSequenceNumber`, `OperationName`, `OperationDescription`, `WorkCenterCode`, `CountPointOperationFlag`, `AutoTransactFlag`, `PlannedStartDate`, and `PlannedCompletionDate`, read from matching `msg.payload.*` paths. Cost transactions read the nested `OperationTransactionDetail` collection from `msg.payload.OperationTransactionDetail` by default.

**Inputs (runtime overrides):** `msg.resource` overrides the configured Resource; `msg.action` overrides the configured Action; `msg.workOrderId`, `msg.operationId`, and `msg.childRecordId` supply IDs when editor fields are blank. Mapping rows can read from `msg.payload`, `msg.dequeued`, any message property path, typed static values including `static JSON`, or the current timestamp. In Entire msg.payload mode, `msg.payload` is the complete Create or Update body. List, Get, and Delete do not send it.

**Outputs:** `msg.payload` (API response), `msg.maintenanceWorkOrderChild` (same successful API response), `msg.workOrderChild` (same successful API response), `msg.statusCode`, `msg.error` (on failure, object: `{ message, code }`)

### create-asset / create-meter-reading / misc-transaction / subinventory-quantity-transfer

Individual SCM transaction nodes. Each targets a specific REST endpoint.

The `create-asset` node appears in the palette as `create installed base asset`.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Mode | `misc-transaction` only | Custom, Miscellaneous Receipt, Miscellaneous Issue, Account Alias Receipt, or Account Alias Issue. Receipt/Issue modes set `TransactionTypeName`; Custom leaves mapped fields unchanged |
| Payload Source | Yes | `Mapped fields` (default) builds the request from mappings. `Entire msg.payload` uses a validated copy of the complete input object and ignores, but retains, saved mappings |
| Payload Mappings | Mapped fields only | Structured rows mapping SCM fields to values |

For `misc-transaction`, `msg.mode` can override the configured Mode with `custom`, `receipt`, `issue`, `accountAliasReceipt`, or `accountAliasIssue`. Receipt and Issue modes set `TransactionTypeName`, so their preset mappings omit that field and use `OrganizationId` for the staged transaction organization. The selected transaction type is also applied to the copied object in Entire msg.payload mode. Account Alias modes set `TransactionTypeName` to `Account Alias Receipt` or `Account Alias Issue`; map the alias field expected by your Fusion setup, such as `AccountAliasName`, plus an optional reason such as `ReasonName`. The node does not alter `TransactionQuantity`; map the positive or negative quantity required by the Fusion transaction setup. `misc-transaction` and `subinventory-quantity-transfer` include a `serials` mapping row for serialized inventory transactions. `subinventory-quantity-transfer` presets include `SubinventoryCode` for the source subinventory and `TransferSubinventory` for the destination.

**Outputs:** `msg.payload` (raw API response), `msg.statusCode`, `msg.error` (on failure, object: `{ message, code }`)

After a successful `subinventory-quantity-transfer` request, the node status is `submitted` because Fusion has created a staged inventory transaction; subsequent Fusion processing determines the final transfer outcome. The other typed transaction nodes retain their operation-specific success statuses.

These typed nodes always call their canonical SCM endpoint. To target a different endpoint, use `fusion-request` with `Transaction Type = custom`.

### delete-transaction

Deletes an SCM resource by identifier using the selected mode endpoint.

Palette label: `delete scm record`.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Delete Type | Yes | Asset, Meter, Misc, Subinventory, or Custom |
| Resource ID | No | If empty, reads from `msg.resourceId` |
| Custom Endpoint | Custom only | Editable HTTPS base endpoint used when Delete Type is `custom`. Query strings are not allowed, and the host must match the configured SCM Server |
| Endpoint | Editor preview | Read-only endpoint preview based on selected Delete Type and SCM Server |

New nodes default to `Delete Type = Custom` so the workspace label stays `delete scm record` until a delete type is selected.

**Inputs (runtime overrides):** `msg.resourceId` overrides the Resource ID field; `msg.mode` overrides the Delete Type (`asset`, `meter`, `misc`, `subinventory`, `custom`)

In custom mode, the node uses the configured Custom Endpoint as the base endpoint. It must use HTTPS and match the configured SCM Server host; query parameters are rejected. The resource ID is URL-encoded before path append, and delete requests time out after 30 seconds.

### get-ib-asset / get-meter-reading / get-organization-id

Individual SCM lookup nodes. Each queries a specific REST endpoint.

| Field | Required | Description |
|-------|----------|-------------|
| SCM Server | Yes | References a scm-server config node |
| Query field (varies) | Yes | Serial Number, Asset Number plus Meter Code, or Organization Name depending on node |
| Endpoint | Editor preview | Read-only endpoint preview based on selected SCM Server |

`get-meter-reading` requires both Asset Number and Meter Code and uses Fusion's
`MetersByAssetMeterUserKey` finder to return the full history for that asset
meter. Multi-page output uses the same normalized collection metadata described
for `scm-lookup` Meter Reading mode.

**Inputs (runtime overrides):** `msg.serialNumber`, `msg.assetNumber` plus `msg.meterCode`, or `msg.organizationName` override the respective query fields

**Outputs:** `msg.payload` (API response), `msg.statusCode`, `msg.error` (on failure, object: `{ message, code }`)

Each node targets a fixed SCM endpoint. To query a different endpoint or use a custom query parameter, use `scm-lookup` in custom mode instead.

---

## OCI Nodes

OCI, IoT REST, and ORDS action nodes keep their normal output success-only. Input failures are reported once through `done(err)`, with normalized `msg.error` fields `{ message, code }`. Server-side detail text is used when available. Node-RED adds its standard Catch source metadata and preserves the original error object in `msg._error`. Existing OCI/ORDS request nodes keep raw response bodies in `msg.payload` when available and add `msg.opcRequestId` when the upstream request ID is available. Streaming Out, Kafka Producer, Functions Invoke, Queue Out, and Queue Ack preserve their input payload on failure.

### oci-config (Config Node)

Simple/API Key authentication reads the PEM file from Private Key Path on the Node-RED host. `~/` means the runtime user's home directory; Passphrase unlocks encrypted keys. Unreadable or invalid keys raise `OCI_PRIVATE_KEY_INVALID` without exposing key contents or paths. Config File authentication uses the SDK config-file provider.

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
| Compartment OCID | No | Default metric compartment for Monitoring Publish and Monitoring Query when their input and node configuration do not specify one. Other service nodes use their own resource identifiers. |
| Test OCI Credentials | — | Calls `listRegions()` to verify credentials |

> **Note:** Instance Principal and Resource Principal only work inside OCI. Config File and API Key work from any machine.

### oci-api-request

Sends one HTTPS request to an OCI API, signed using the credentials from `oci-config`.

| Field | Required | Description |
|-------|----------|-------------|
| OCI Config | Yes | References an `oci-config` node for OCI request signing |
| Endpoint | Yes | Complete HTTPS OCI endpoint. The hostname must belong to an OCI realm known to the installed SDK |
| Method | Yes | `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, or `DELETE` |
| Relative Path | No | Path appended to the endpoint without replacing its existing base path |
| Query | No | JSON object of query parameters. Array values create repeated parameters |
| Headers | No | JSON object of additional headers. Signing, host, date, content-length, digest, and delegation-token headers are protected |
| Response | No | `auto` (default), `json`, `text`, or `buffer` |
| Timeout (ms) | No | Request timeout from 1 to 300000 milliseconds. Default: `30000` |

**Runtime overrides:** `msg.method`, `msg.ociPath`, `msg.ociQuery`, and `msg.ociHeaders`. For `POST`, `PUT`, and `PATCH`, `msg.payload` is a JSON-serializable object or text request body. Buffer bodies are rejected; use a service-specific binary transfer node such as `oci-object-storage`. The configured endpoint cannot be overridden at runtime.

**Outputs:** `msg.payload`, `msg.statusCode`, `msg.responseHeaders`, `msg.opcRequestId`, `msg.opcWorkRequestId`, `msg.nextPage`, `msg.ociUrl`, `msg.ociMethod`, and `msg.error` on failure (`{ message, code }`).

Configure the complete endpoint for an API that accepts OCI request signatures; there is no service dropdown. The node rejects non-HTTPS and non-OCI-realm targets before loading credentials. It does not follow redirects, retry requests, or fetch additional pages automatically. Use an OAuth or ordinary HTTP node for endpoints that do not accept OCI signatures.

### oci-monitoring-publish

Publishes one custom OCI Monitoring metric data point per input message.

| Field | Required | Description |
|-------|----------|-------------|
| OCI Config | Yes | References an `oci-config` node for authentication and region |
| Compartment OCID | No* | Metric compartment. `msg.payload.compartmentId` takes precedence, then this field, then the `oci-config` default. *One must provide a value |
| Namespace | Yes | Custom Monitoring namespace |
| Metric Name | Yes | Numeric metric name |
| Resource Group | No | Optional metric group within the namespace |
| Dimensions | No | JSON object containing string dimension values. Default: `{}` |
| Metadata | No | JSON object containing string metadata values. Default: `{}` |

**Input:** `msg.payload` is either a finite number or an object with required numeric `value` and optional `timestamp`, `count`, `compartmentId`, `namespace`, `name`, `resourceGroup`, `dimensions`, and `metadata`. Per-message dimensions and metadata replace their configured maps.

**Outputs:** `msg.payload` contains `failedMetricsCount`, `failedMetrics`, `opcRequestId`, and `statusCode`; the node also sets `msg.statusCode`, `msg.opcRequestId`, and `msg.error` on failure (`{ message, code }`). A nonzero `failedMetricsCount` routes the message through Catch because this node submits exactly one metric data point; `msg.payload` retains the rejection details.

The node derives the realm-correct regional `telemetry-ingestion` endpoint from the OCI SDK endpoint. Use it for selected operational measurements such as latency, availability, throughput, queue depth, and failure counts; send detailed diagnostic events to OCI Logging.

### oci-monitoring-query

Queries OCI Monitoring metric series using Monitoring Query Language (MQL).

| Field | Required | Description |
|-------|----------|-------------|
| OCI Config | Yes | References an `oci-config` node for authentication and region |
| Compartment OCID | No* | Metric compartment. `msg.metricQuery.compartmentId` takes precedence, then this field, then the `oci-config` default. *One must provide a value |
| Namespace | Yes | Monitoring metric namespace |
| MQL Query | Yes | Metric name, interval, and aggregation expression |
| Resource Group | No | Optional resource group filter |
| Resolution | No | Optional query resolution such as `1m` |
| Lookback (min) | No | Relative time range ending now. Default: `60` |

**Runtime overrides:** `msg.metricQuery` may contain `compartmentId`, `namespace`, `query`, `resourceGroup`, `resolution`, `lookbackMinutes`, `startTime`, or `endTime`. Explicit times must be valid and start time must precede end time.

**Outputs:** `msg.payload` is the array of returned metric streams and aggregated data points; the node also sets `msg.statusCode`, `msg.opcRequestId`, and `msg.error` on failure (`{ message, code }`).

All three nodes preserve upstream message fields, including the opaque `msg._dbTransaction` reference. OCI operations are external side effects and are not rolled back by End Transaction. Route failures through a scoped Catch; each failed input reports once. Do not send transaction references to OCI services.

### oci-streaming-config (Config Node)

Shared native OCI Streaming data-plane connection used by Streaming Out and Streaming In.

| Field | Required | Description |
|-------|----------|-------------|
| Name | No | Optional display name |
| OCI Config | Yes | References an `oci-config` authentication node |
| Stream OCID | Yes | Target native OCI stream identifier |
| Messages Endpoint | Yes | Stream pool's HTTPS Messages endpoint shown in the stream details |

The endpoint must use the exact native OCI Streaming Messages host structure, an SDK-known OCI realm domain, and the default HTTPS port. Validation occurs before credentials are requested. The SDK client is created on demand and shared by referencing nodes; shutdown releases its circuit breaker without closing the authentication provider shared by `oci-config`. There is no config-node connection test because native Streaming has no permission-neutral data-plane operation.

### oci-streaming-out

Publishes one record or an explicit batch to native OCI Streaming.

| Field | Required | Description |
|-------|----------|-------------|
| Name | No | Optional display name |
| Streaming Config | Yes | References an `oci-streaming-config` node |

**Inputs:**

- `msg.payload` supplies one record. Objects and arrays are JSON-serialized; strings and Buffers retain their bytes; finite numbers, booleans, and null become strings. A payload array remains one JSON record.
- `msg.ociStreaming.key` optionally supplies the single record's key and uses the same serialization rules.
- `msg.ociStreaming.messages` overrides the single record with a non-empty explicit batch shaped as `{ value, key? }`.
- `msg.ociStreaming.opcRequestId` optionally supplies a non-empty caller request ID.

Keys are limited to 256 bytes. Each value and the total decoded keys plus values in one request are limited to 1 MiB. OCI does not impose a separate record-count limit for a request.

**Outputs:** Preserves the input, sets `msg.statusCode`, and stores the Stream OCID, OCI put-messages result, and response request ID in `msg.ociStreaming.streamOcid`, `msg.ociStreaming.result`, and `msg.ociStreaming.opcRequestId`. Successful result entries contain partition, offset, and timestamp metadata.

If OCI accepts the request but reports one or more per-record errors, the node retains the partial result metadata and routes the message through Catch. Validation and service failures also set `msg.error = { message, code }`; values and keys are not written to status or error logs.

The node makes one PutMessages attempt per input. Retrying through a flow may duplicate records already accepted by OCI, including successful entries from a partially failed batch.

### oci-streaming-in

Starts consuming one native OCI stream through an OCI Streaming consumer group when the flow is deployed. This source node has no input and emits individual records or batch arrays.

| Field | Required | Description |
|-------|----------|-------------|
| Name | No | Optional display name |
| Streaming Config | Yes | References an `oci-streaming-config` node |
| Consumer Group ID | Yes | Stable group identifier. Instances using the same group share partition reservations and committed positions |
| Instance Name | No | Unique member name; generated from the Node-RED node ID when empty |
| Start Position | Yes | Latest or Beginning. Used only when OCI first creates the consumer group |
| Output Mode | Yes | Individual (default) or Batch array |
| Batch Limit | Yes | Maximum records requested in Automatic or Batch array mode, from 1 to 10000. Manual Individual requests one record. Default: 10; OCI may return fewer |
| Commit Mode | Yes | Automatic or Manual. Default: Automatic |
| Retry Delay (ms) | Yes | Delay before retrying failed cursor/read operations, from 100 to 300000. Default: 1000 |

**Outputs:** `msg.payload` contains parsed JSON when valid, UTF-8 text otherwise, or a Buffer for binary data. `msg.statusCode` contains the GetMessages HTTP status. `msg.ociStreaming` contains `streamOcid`, `stream`, `partition`, `offset`, `key`, `timestamp`, `consumerGroupId`, `instanceName`, `opcRequestId`, and `autoCommit`. Manual mode also sets runtime-only `commitToken` and `consumerNodeId` values for Streaming Commit. OCI cursors are retained only inside the source node and never emitted.

In Batch array mode, payload is an array of decoded values. Common source/group/instance/request/autoCommit metadata remains on `msg.ociStreaming`; per-record `stream`, `partition`, `offset`, `key`, and `timestamp` are instead in `msg.ociStreaming.records`, aligned with the payload array. `messageCount` reports the emitted record count. Manual batches have one source-owned token covering the whole batch.

Automatic mode creates the group cursor with commit-on-get enabled, so the next GetMessages request commits the position returned by the previous request. It records source delivery rather than successful downstream completion. Manual mode requests and emits one record (Individual) or up to Batch Limit records (Batch array), waits for Streaming Commit, and sends heartbeats every 10 seconds while waiting. Normal forward progress waits for OCI to confirm the commit; cursor/reservation recovery can instead invalidate and replay the pending work. Existing group offsets take precedence over Start Position in either mode.

Startup and read failures route through Catch and retry after Retry Delay. Expired cursors and lost partition reservations trigger a rejoin with the same stream, group, and instance; outstanding manual tokens are invalidated. Existing groups resume from service-committed offsets. If the group itself has expired, recovery starts at the oldest retained records rather than skipping to Latest. A retention-loss error stops consumption for administrator review and an explicit group-position reset/redeploy; the node never calls UpdateGroup automatically. A stopped or redeployed manual source also invalidates outstanding runtime tokens. Uncommitted records or batches remain eligible for replay while retained, including records whose downstream work succeeded. Delivery is at least once, so downstream side effects should be idempotent.

Manual mode suppresses repeats at or below this running source's successfully committed offset per partition. History is local to the source's stream/group runtime, never shared with other consumers, and cleared on restart. Uncommitted records are not suppressed. Duplicate-only reads advance using OCI's next read cursor with a 1 second pause; five consecutive duplicate-only reads report one Catch error until progress resumes. Stop all affected consumers before intentionally resetting a group, then restart to clear local history. Manual offsets must be nonnegative JavaScript safe integers; unsafe offsets fail rather than risk incorrect suppression. This guard is not durable deduplication or an exactly-once guarantee.

Read starts are spaced at least 210 ms apart per node using elapsed monotonic time. Request time and manual processing/commit time count toward that interval; no extra pause is added when they already take 210 ms or longer. Empty responses add a 1 second idle pause. Timers do not block Node-RED and are cancelled on stop/redeploy. SDK retry/backoff remains enabled independently of Retry Delay; outer read retries also respect the minimum read-start interval. The per-node ceiling is approximately 4.76 read calls per second (and records per second in single-record Manual mode), before other service or processing constraints. Automatic mode and Manual Batch array mode can receive multiple records per call. Tune Batch Limit for record size and downstream latency; batch size is a maximum, not a minimum. This is not a partition-aware or shared quota limiter across nodes or runtimes; other consumers using the same stream/group can still cause throttling.

After a non-empty read, `received N` remains visible for two seconds without pausing the next automatic read or manual heartbeat. The node then restores the blue-ring `consuming` or `awaiting commit` state that is current at that time.

### oci-streaming-commit

Commits one record or one whole batch emitted by Streaming In in Manual mode.

| Field | Required | Description |
|-------|----------|-------------|
| Name | No | Optional display name |

**Inputs:** Requires the unchanged `msg.ociStreaming.commitToken` and `msg.ociStreaming.consumerNodeId` emitted by an active Streaming In node in Manual mode.

**Outputs:** Preserves the input and sets `msg.ociStreaming.committed = true`, plus the committed record's partition/offset (Individual) or `messageCount` (Batch array), and OCI request ID. Missing, stale, duplicate, cross-node, or automatic-mode metadata routes through Catch. A transient OCI commit failure retains the token for retry while the source remains active. Cursor expiry, reservation loss, retention loss, or source shutdown invalidates it; wait for a new delivery instead of retrying the old token.

For a batch, preserve the original metadata and commit once, after every record succeeds. A token for `[A, B, C]` commits all three even if the payload now contains only A. If B fails, do not commit that token; splitting the payload does not create separate commits.

### oci-kafka-config (Config Node)

Shared connection settings for OCI Managed Kafka (OCI Streaming with Apache Kafka). Kafka broker credentials are separate from OCI API key credentials, so this node does not reference `oci-config`.

| Field | Required | Description |
|-------|----------|-------------|
| Name | No | Optional display name |
| Bootstrap Brokers | Yes | Comma- or whitespace-separated `host:port` entries. URL schemes, paths, queries, fragments, and credentials are rejected |
| Client ID | No | Kafka client identifier. Default: `node-red-oci-kafka` |
| SASL Username | Yes | SASL/SCRAM superuser name shown by the managed Kafka credential setup |
| SASL Password | Yes | Generated password from the associated OCI Vault secret, stored in Node-RED credentials |
| Test Kafka Connection | — | Connects the deployed cached producer to validate broker access and credentials |

Connections always use TLS with SASL/SCRAM-SHA-512. Create the Vault secret with manual secret generation, associate it with the cluster using **Update SASL SCRAM**, then enter the cluster's SASL/SCRAM superuser name and the generated password stored in that secret. The producer is created on demand and shared by referencing Producer nodes. Each Consumer node owns and closes its consumer client.

### oci-kafka-producer

Publishes telemetry or derived events to OCI Managed Kafka (OCI Streaming with Apache Kafka).

| Field | Required | Description |
|-------|----------|-------------|
| Name | No | Optional display name |
| Kafka Config | Yes | References an `oci-kafka-config` node |
| Topic | No* | Default topic. *Required here or in `msg.kafka.topic` |

**Inputs:**

- `msg.payload` is the record value. Objects and arrays are JSON-serialized; strings and buffers are sent directly; finite numbers, booleans, and null become strings.
- `msg.kafka.topic` overrides Topic.
- `msg.kafka.key`, `msg.kafka.headers`, and non-negative integer `msg.kafka.partition` provide optional record attributes. Header values may be strings, buffers, finite numbers, booleans, or null.

**Outputs:** Preserves the input payload and upstream properties; sets the resolved `msg.kafka.topic` and broker delivery metadata in `msg.kafka.result`.

Kafka client retry behavior applies without an additional node-level retry loop. Validation or broker failures set `msg.error` and route through Catch.

### oci-kafka-consumer

Starts consuming one OCI Managed Kafka topic when deployed and emits individual records or partition-scoped batch arrays. This node has no input.

| Field | Required | Description |
|-------|----------|-------------|
| Name | No | Optional display name |
| Kafka Config | Yes | References an `oci-kafka-config` node |
| Topic | Yes | The single existing topic to consume. The node disables automatic topic creation |
| Consumer Group ID | Yes | Stable Kafka group identifier. Consumers using the same ID share topic partitions |
| Read From Beginning | Yes | For a group without a committed offset, start at the earliest available record. Default: off |
| Commit Mode | Yes | Automatic lets the client commit delivered offsets; Manual waits for Kafka Commit. Default: Automatic |
| Output Mode | Yes | Individual messages (default) or Batch array |
| Batch Limit | In Batch array mode | Maximum native batch size, 1–2147483647. Default: `32`; batches may be smaller |

**Outputs:** `msg.payload` contains parsed JSON when valid, UTF-8 text otherwise, or a Buffer for binary data. `msg.kafka` contains `topic`, `partition`, `offset`, `key`, `headers`, `timestamp`, `consumerGroupId`, and `autoCommit`. Keys and headers become UTF-8 text when valid; binary values remain Buffers. Manual mode also sets runtime-only `commitToken` and `consumerNodeId` values for Kafka Commit.

In Batch array mode, `msg.payload` is an array of decoded values and `msg.kafka.records` contains aligned topic, partition, offset, key, headers and timestamp metadata. Root Kafka metadata retains topic, partition, consumer group, autoCommit and `messageCount`, plus manual commit metadata when applicable. Each batch belongs to one partition. An array-valued record remains one entry; array contents are never split. There is no wait to fill Batch Limit.

An existing committed offset always takes precedence over Read From Beginning. Automatic mode records delivery from the Consumer node, not completion of downstream processing. Manual mode holds one record or batch per assigned partition until Kafka Commit succeeds; a restart or rebalance before commit can replay records from the group's last committed offset. Consumption failures set `msg.error` and route through Catch; closing the node disconnects its owned consumer.

Manual delivery pauses only the pending partition and promptly returns control to the native Kafka client, so other partitions and native polling/heartbeats continue. A successful explicit commit resumes that partition. Revocation or reassignment invalidates affected tokens without committing them; lost ownership invalidates all pending tokens. A late commit response after invalidation cannot report success or resume a new owner's partition. A request already sent may nevertheless have committed on the broker, so downstream handling must tolerate ambiguous outcomes. Both the record offset and next offset must fit JavaScript's safe-integer range; larger offsets are unsupported by the installed native adapter and are not emitted or explicitly committed by the node.

After delivery, `received N` remains visible for two seconds without pausing consumption or heartbeats. The node then restores the blue-ring `consuming` or `awaiting commit` state that is current at that time.

### oci-kafka-commit

Commits one record or a complete partition-scoped batch emitted by Kafka Consumer in Manual mode.

| Field | Required | Description |
|-------|----------|-------------|
| Name | No | Optional display name |

**Inputs:** Requires the unchanged `msg.kafka.commitToken` and `msg.kafka.consumerNodeId` emitted by an active Kafka Consumer in Manual mode.

**Outputs:** Preserves the input, sets `msg.kafka.committed = true`, and includes `msg.kafka.nextOffset`, the committed position after the processed record. Missing, stale, duplicate, cross-node, or automatic-mode metadata routes through Catch. A failed broker commit retains the token for retry only while the source still owns that delivery. After revocation, reassignment or shutdown, use the new delivery's token instead.

Kafka commits the next offset, confirming the processed record and every earlier offset in that partition. Manual mode is at-least-once rather than exactly-once, so downstream processing should be idempotent.

For batch delivery, commit only after every record succeeds. A token for `[A, B, C]` commits all three even if the payload now contains only A. If B fails, do not commit that token. Successful output adds the original `messageCount` and `nextOffset` after the final record. Other partitions remain independent.

### oci-functions-invoke

Invokes an OCI Function through the native OCI SDK. Synchronous invocation is the default.

| Field | Required | Description |
|-------|----------|-------------|
| Name | No | Optional display name |
| OCI Config | Yes | References an `oci-config` authentication node |
| Function OCID | Yes* | Function identifier. *May be overridden by `msg.ociFunction.functionOcid` |
| Invoke Base Endpoint | Yes* | HTTPS OCI Functions base origin without the invoke path. *May be overridden by `msg.ociFunction.invokeEndpoint` |
| Invoke Type | Yes | `sync` (default) or `detached` |
| Intent | Yes | `httprequest` (default) or `cloudevent` |

**Inputs:** `msg.payload` is the request body. Objects and arrays are JSON-serialized; strings and buffers are passed directly; an undefined payload sends no body. `msg.ociFunction` may override `functionOcid`, `invokeEndpoint`, `invokeType`, or `intent`, and may set `opcRequestId` or boolean `isDryRun`.

**Outputs:** Replaces `msg.payload` with the response body: parsed JSON when valid, text for other UTF-8 content, or a Buffer for binary content. Detached invocation normally returns an empty string. Sets `msg.statusCode` and merges the resolved function, endpoint, mode, intent, and OCI request ID into `msg.ociFunction`.

Configured and message-level endpoints must use the exact OCI Functions host structure, an SDK-known OCI realm domain, and the default HTTPS port; validation occurs before authentication is requested. Detached success means OCI accepted the request; the function may still be running or may later fail. Track completion separately, or use Synchronous mode when the next node needs the function's returned result.
The configured endpoint client is cached for reuse. A message-level endpoint override uses a request-scoped client whose circuit breaker is released after the response stream is read, avoiding an unbounded endpoint-client cache without closing the authentication provider shared by `oci-config`.

### oci-queue-config (Config Node)

Shared OCI Queue data-plane connection used by Queue Out, Queue In, and Queue Ack.

| Field | Required | Description |
|-------|----------|-------------|
| Name | No | Optional display name |
| OCI Config | Yes | References an `oci-config` authentication node |
| Queue OCID | Yes | Target queue identifier |
| Messages Endpoint | Yes | Queue-specific HTTPS Messages endpoint from the OCI Queue resource details |
| Test OCI Queue Connection | — | Calls queue statistics after deploy to validate authentication, endpoint, and queue access |

The endpoint must use the exact OCI Queue messages host structure, an SDK-known OCI realm domain, and the default HTTPS port; validation occurs before OCI credentials are requested. Publishing, acknowledgement and connection tests share a cached SDK client. Each Queue In owns a separate cancellable receive client using the same authentication provider. Receiver clients use direct SDK HTTP transport with Queue In's retry delay rather than the SDK circuit breaker. Shutdown does not close the authentication provider shared by `oci-config`.

### oci-queue-out

Publishes one message or an explicit batch to OCI Queue.

| Field | Required | Description |
|-------|----------|-------------|
| Name | No | Optional display name |
| Queue Config | Yes | References an `oci-queue-config` node |

**Inputs:**

- `msg.payload` supplies a single message. Objects and arrays are JSON-serialized; strings, finite numbers, booleans, and null become OCI Queue string content. Buffers must be explicitly encoded as strings.
- `msg.ociQueue.metadata` optionally supplies `{ channelId, customProperties? }` for the single message. `channelId` is required when metadata is present, and custom property values must be strings.
- `msg.ociQueue.messages` overrides the single payload with 1–20 entries shaped as `{ content, metadata? }`.
- `msg.ociQueue.opcRequestId` optionally supplies the caller request ID.

**Outputs:** Preserves the input, sets `msg.statusCode`, and stores the queue OCID, OCI put-messages result, and response request ID in `msg.ociQueue.result`, `msg.ociQueue.queueOcid`, and `msg.ociQueue.opcRequestId`.

After a successful request, status reports `enqueued N` using the actual number of messages submitted in the request.

### oci-queue-in

Starts polling on deploy and emits individual OCI Queue messages or a batch array per non-empty receive. This node has no input.

| Field | Required | Description |
|-------|----------|-------------|
| Name | No | Optional display name |
| Queue Config | Yes | References an `oci-queue-config` node |
| Output Mode | Yes | Individual messages (default) or Batch array |
| Batch Limit | Yes | Maximum messages per request, 1–20. Default: `10` |
| Poll Timeout (seconds) | Yes | OCI Queue long-poll timeout, 0–30. Default: `20`; `0` uses short polling |
| Visibility (seconds) | No | Message visibility timeout, 0–43200. Empty uses the queue default |
| Channel Filter | No | Optional OCI Queue channel selector |
| Consumer Group ID | No | Optional consumer group passed to receive and acknowledgement |
| Retry Delay (ms) | Yes | Delay after receive failures and empty short polls, 100–300000. Default: `5000` |

**Outputs:** `msg.payload` contains parsed JSON when valid, otherwise raw string content. `msg.statusCode` contains the OCI receive HTTP status. `msg.ociQueue` contains `queueOcid`, `id`, `receipt`, `deliveryCount`, `visibleAfter`, `expireAfter`, `createdAt`, `metadata`, `consumerGroupId`, and `opcRequestId`.

In Batch array mode, `msg.payload` contains the decoded contents, `msg.ociQueue.records` holds aligned per-message metadata including each receipt, and `msg.ociQueue.messageCount` gives the count. The root metadata retains queue, consumer group and request ID. Batches need not fill Batch Limit. An array-valued single message remains one record in either mode and remains subject to the service's per-message size limit.

Queue In does not auto-delete messages. Send the successful processing path to `oci-queue-ack`; leave failed work unacknowledged so OCI Queue can redeliver it after visibility expires. Queue-level delivery-attempt and dead-letter settings govern repeatedly failed messages. After a non-empty poll, `received N` remains visible for two seconds while the next poll starts immediately, then the blue-ring `waiting` status returns. Empty polls emit nothing and continue. Closing aborts the owned HTTP receive and returns promptly even if authentication is still pending; late completions cannot start a receive or emit messages. Cancellation does not affect other nodes, but an already accepted service request may still hide messages until visibility expires. The SDK may log a single cancellation warning during shutdown; the node does not retry it or route it through Catch.

### oci-queue-ack

Explicitly acknowledges received OCI Queue messages by deleting one message or an explicit batch.

| Field | Required | Description |
|-------|----------|-------------|
| Name | No | Optional display name |
| Queue Config | Yes | References the same `oci-queue-config` used by Queue In |

**Inputs:** Individual messages require `msg.ociQueue.receipt`; batches require aligned `msg.ociQueue.records` as described below. `msg.ociQueue.consumerGroupId` is forwarded when present, and `msg.ociQueue.ackOpcRequestId` may supply a delete request ID.

**Outputs:** Preserves the input and sets `msg.ociQueue.acknowledged` to `true`, replaces `msg.ociQueue.opcRequestId` with the delete response request ID, and sets `msg.statusCode` (normally `204` for individual deletion or `200` for a batch).

Missing or stale receipts route through Catch. Receipt values are redacted if a service error repeats them.

**Batch acknowledgement:** `msg.ociQueue.records` selects one `DeleteMessages` request; an array payload alone does not. Preserve the aligned payload, records, messageCount, queue and consumer group. Batches require 1–20 distinct receipts and must match Queue Config. Successful output includes positional `ackResults` with `index` and `acknowledged`, plus `acknowledgedCount` and `failedCount`.

OCI may delete some messages and reject others. Partial failure goes to Catch with acknowledgement false, the original payload/receipts and `msg.ociQueue.ackResults`. If A and C were deleted but B failed, retry only B's deletion: keep B's payload and receipt together and set `messageCount` to `1`. Malformed responses or network failures leave outcomes unknown; do not assume no messages were deleted.

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
| Request Timeout (ms) | No | Maximum time to receive a complete response, not just HTTP headers. Each OAuth token or ORDS data request has its own timer. Default: `30000`. Closing the config aborts active requests, including body reads. |
| Fallback Expiry (min) | No | Token cache duration when `expires_in` is absent. Default: `60` |
| Max Concurrent Polls | No | Maximum active `oci-ords-poll` jobs for this config. Regular ORDS request nodes ignore this setting. Default: `5` |
| Max Queued Polls | No | Maximum waiting `oci-ords-poll` jobs for this config. New polling jobs fail fast when the queue is full. Default: `100` |
| Test OAuth Token | — | Requests an OAuth token with the deployed credentials. Requires a Token URL. |

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

After close or redeploy, late responses cannot produce successful output. Pending polls detect closure with `ORDS_NODE_CLOSED`. Already-issued HTTP requests may finish; other nodes sharing the ORDS config are unaffected.

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

Status uses an active dot while `polling`, then reports `poll completed` on success or `poll timed out` when the timeout expires.

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
| File Path | No | Upload source path only when `msg.payload` is absent or null; an empty string uploads zero bytes. Also used as the download destination path. |
| Content Type | No | Upload content type (for example `application/json`) |
| Download Output | No | `buffer` (default) or `text` |
| Encoding | No | Text encoding used when Download Output is `text` (default: `utf8`) |

**Runtime overrides:** `msg.operation`, `msg.namespace`, `msg.bucketName`, `msg.objectName`, `msg.filePath`, `msg.contentType`, `msg.downloadOutput`, `msg.encoding`

**File access:** File paths use the Node-RED process's filesystem permissions; downloads can overwrite existing files. Validate message overrides against approved operations and paths before this node. Editor settings do not restrict overrides from incoming messages.

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

Clicking **Done** saves the current Payload Mappings rows; reopening the node restores them.

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
| Entity OCID | No | Optional Log Analytics entity. Uses `msg.entityOcid` only when this field is blank |
| Default Severity | No | Injected as `level` when payload object has no `level` field. Overridden by `msg.severity` |
| Payload Source | No | `Payload Mappings` (default) or `msg.payload` |
| Payload Mappings | No | Mapping rows from dequeued data, msg property, or static value |

Clicking **Done** saves the current Payload Mappings rows; reopening the node restores them.

**Runtime inputs:** `msg.namespace`, `msg.logGroupOcid`, `msg.logSourceName`, and `msg.entityOcid` are used only when their editor fields are blank. `msg.severity` overrides Default Severity when the log payload has no `level` field.

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
| Test MQTT Connection | — | Creates a temporary MQTT connection to verify the Device Host and credentials |

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

Auto Timestamp rejects a null payload. Payloads that cannot be serialized as JSON also route to Catch with `invalid payload`, without publishing. Null remains unchanged when Auto Timestamp is disabled.

**Outputs:** `msg.payload` (passed through), `msg.topic` (MQTT topic published to)

Status uses an active dot while `connecting`, then reports `connected`, `publishing`, or `published` as the connection and publish operation progress.

### iot-subscribe

Receives commands delivered by OCI IoT to the configured device through an MQTT request endpoint. This node has **no input** — commands arrive from OCI IoT.
Palette label: `subscribe`.

| Field | Required | Description |
|-------|----------|-------------|
| IoT Device | Yes | References an iot-config node for the MQTT connection |
| Topic | Yes | MQTT command request endpoint to subscribe to. Supports `#` (multi-level) and `+` (single-level) wildcards. `#` must be the final segment and `+` must occupy a full segment. Invalid patterns are rejected at startup |
| QoS | Yes | Subscription QoS level (0, 1, or 2) |

**Outputs:** `msg.payload` (incoming command as a JSON object or string — JSON is auto-detected), `msg.topicSuffix` (portion of the request endpoint topic matched by `#`, or last segment for fixed topics), `msg.topic` (full request endpoint topic)

The node acquires its configured MQTT connection and registers the command request endpoint subscription on deploy, even when its output is not wired. Remove, disable, or leave the IoT Device field unconfigured when a subscription must remain inactive.

Status reports `received` for each command and immediately restores blue-ring `listening`.

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
- Errors: each failed input is reported once through `done(err)` to Catch, with `msg.error` populated

**Notes:**
- This node resolves `relationshipKey` to a relationship OCID before update.
- V1 intentionally supports relationship-content update only; full relationship CRUD is deferred.
- Runtime values take precedence over editor defaults:
  - `iotDomainId`: `msg.iotDomainId` -> editor field
  - `relationshipKey`: `msg.relationshipKey` -> `msg.payload.relationshipKey` -> Default Relationship Key
  - `content`: `msg.content` -> `msg.payload.content` -> Default Content

## SCM Payload Sources and Mappings

Mapped Fusion action nodes support two mutually exclusive request-data modes:

- **Mapped fields** (default) builds the request only from the configured mapping rows and never falls back to `msg.payload`.
- **Entire msg.payload** validates and deep-copies the complete `msg.payload` object. Saved mappings remain configured but are ignored until the node is switched back to Mapped fields.

Mapped fields requires at least one usable mapping for operations that send a request body. An empty table is rejected before OAuth token acquisition even when the input contains an object in `msg.payload`. Parameterless `GET` and `DELETE` operations remain valid without mappings; use Entire msg.payload when a `GET` should derive query parameters from the input object.

Direct payload mode requires a plain JSON-compatible object. It rejects arrays or scalar root values, circular references, unsupported values such as functions and `BigInt`, non-finite numbers, custom object prototypes, and prototype-pollution keys. Validation occurs before OAuth token acquisition, and nodes add their documented defaults or Fusion wrapper only to the copied object so the incoming message is not mutated.

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

Message and dequeued paths are relative to their source. Enter `payload.AssetNumber`, not `msg.payload.AssetNumber`; enter `AssetNumber`, not `msg.dequeued.AssetNumber`. Each row previews the resolved path. Switching between Message property and Dequeued data converts the conventional `payload.<SCMField>` and `<SCMField>` forms automatically; custom paths are preserved. Known Fusion fields show inline type warnings, and runtime validation routes duplicate prefixes, destructive static-type mismatches, invalid ISO date-times, and invalid static JSON to Catch before an API request is sent. Unknown custom fields keep all source options without field-type restrictions.

Clicking **Done** persists the current mapping rows for preset and Custom modes. Reopening the node restores the saved rows rather than regenerating defaults or clearing Custom mappings.

## Typical Flows

**Transactional database processing:**
`begin transaction` → `dequeue` → `sql` → `end transaction (commit)`
Preserve the transaction reference through Catch and message-cloning paths, and join transaction branches before End as described above. External SCM requests are not rolled back with the database transaction.

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

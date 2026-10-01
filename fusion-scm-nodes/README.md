# Node-RED SCM Nodes

This project provides a set of custom Node-RED nodes that integrate Oracle Fusion Cloud SCM with the OCI IoT Platform service. The nodes enable actions such as asset creation, meter readings, inventory transactions, SCM lookups, and telemetry-to-SMO transformation using Node-RED flows.

## Nodes

| Node type | Palette label | Description |
|-----------|---------------|-------------|
| **scm-server** | Not in palette | Oracle Fusion Cloud SCM authentication, connection, and proxy config. |
| **fusion-request** | `fusion request` | Unified transaction node that starts in Custom mode, supports guarded Resource Item, ADF Action, JSON, and ADF Batch media types, and includes Create Asset, Meter Reading, Miscellaneous Transaction, and Subinventory Transfer presets. |
| **scm-lookup** | `scm lookup` | Unified lookup node that starts in Custom mode, accepts normalized complete Fusion GET URLs, and supports Asset, Meter Reading by asset-meter finder, Inventory Organization, Item, Subinventory, On-Hand Quantity, Recipe/Work Definition, Batch/Manufacturing Work Order, manufacturing child-resource lookups with explicit parent resource IDs, and Maintenance Work Order presets. |
| **smo-transformer** | `smart operations transformer` | Transforms telemetry data into structured Smart Operations event payloads after an event type preset or custom event type is selected. |
| **smo-event** | `smart operations event` | Sends structured Smart Operations operational events to Fusion SCM. |
| **manufacturing-work-order** | `manufacturing work order` | Creates or updates discrete manufacturing work order headers. |
| **manufacturing-work-order-child** | `manage manufacturing work order details` | Manages manufacturing work order operations, components, resources, serials, and progress/quantity reporting. |
| **manufacturing-production-transaction** | `manufacturing production transaction` | Posts batch/work order production reporting transactions for operations, materials/ingredients, and output products. |
| **maintenance-work-order** | `maintenance work order` | Creates or updates maintenance work order headers. |
| **maintenance-work-order-child** | `manage maintenance work order details` | Manages maintenance work order operations, materials, resources, and cost-impacting operation transactions. |
| **create-asset** | `create installed base asset` | Creates an Installed Base Asset. |
| **create-meter-reading** | `create meter reading` | Creates a Meter Reading. |
| **misc-transaction** | `miscellaneous transaction` | Creates a Miscellaneous Inventory Transaction with Custom, Miscellaneous Receipt/Issue, and Account Alias Receipt/Issue modes. |
| **subinventory-quantity-transfer** | `subinventory quantity transfer` | Creates a Subinventory Transfer. |
| **delete-transaction** | `delete scm record` | Deletes an SCM resource by mode-specific ID; starts in Custom mode and supports Asset, Meter, Misc, and Subinventory presets. |
| **get-ib-asset** | `get installed base asset` | Retrieves an asset by Serial Number. |
| **get-meter-reading** | `get meter reading` | Retrieves complete meter history by Asset Number and Meter Code. |
| **get-organization-id** | `get organization id` | Retrieves an organization by name. |

## Installation

Install the nodes from within your Node-RED environment.

### Cloning the Repository

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

### Prerequisites

- Node-RED v3.0+
- Node.js v18+
- npm

### Install the Node Package

Install the node package using the [installation guide](https://github.com/oracle-samples/node-red-nodes/blob/v0.7.0/docs/installation.md). Its dependencies are installed automatically; installing dependency libraries alone does not register the nodes.

## Payload Sources and Mappings

Mapped Fusion action nodes provide two mutually exclusive payload sources:

- **Mapped fields** (default) builds the request only from the mapping table and never falls back to `msg.payload`.
- **Entire msg.payload** validates and deep-copies the complete `msg.payload` object. Saved mappings are retained but ignored until the node is switched back to Mapped fields.

Mapped fields requires at least one usable mapping for operations that send a request body. An empty table is rejected before OAuth token acquisition even when the input contains an object in `msg.payload`. Parameterless `GET` and `DELETE` operations remain valid without mappings; use Entire msg.payload when a `GET` should use the input object as query parameters.

Entire msg.payload mode requires a plain JSON-compatible object. Invalid root values, unsupported nested values, circular references, custom object prototypes, and prototype-pollution keys are rejected before OAuth token acquisition. Nodes apply their documented mode defaults and Fusion wrappers to the copied object without mutating the incoming payload.

All SCM nodes that use payload mappings support structured mapping rows with typed source options:

| Source | Reads from | Value field |
|--------|-----------|-------------|
| **dequeued data** | `msg.dequeued.<value>` | Just the field name (e.g. `AssetNumber`) |
| **msg property** | `msg.<value>` | Full property path (e.g. `payload.someField`) |
| **static text** | Literal string | The constant text value (e.g. `NODE_RED`) |
| **static number** | Numeric literal | The constant number value (e.g. `1`) |
| **static boolean** | Boolean literal | Dropdown value: `true` or `false` |
| **static JSON** | Parsed JSON | A JSON array/object/value for nested fields such as `serials` |
| **current timestamp** | Runtime clock | Leave blank; generated as an ISO timestamp at runtime |

Message and dequeued paths are relative: enter `payload.AssetNumber` for a Message property, or `AssetNumber` for Dequeued data. Switching between those sources converts conventional `payload.<SCMField>` and `<SCMField>` paths automatically while preserving custom paths. The editor previews the resolved `msg.*` path and warns about duplicate prefixes or known static-type mismatches. New presets use `msg.payload.*` for business data, runtime timestamps for applicable dates, and typed constants only for known Fusion values.

Clicking **Done** saves the current mapping rows for both preset and Custom modes; reopening the node restores those saved rows.

`misc-transaction` Receipt and Issue modes set `TransactionTypeName` to the matching Fusion transaction type and leave `TransactionQuantity` unchanged. Account Alias modes use the named alias field you map, such as `AccountAliasName`, instead of requiring users to map a raw account number. Use Custom mode when you want to map every transaction attribute yourself.
`misc-transaction` and `subinventory-quantity-transfer` include a `serials` mapping row for serialized inventory transactions; set it from a message property or `static JSON`.

## SCM Server

Enter the Fusion hostname without a protocol or path, then enter the API version supplied for the environment. The editor previews the derived `https://<fusion-host>/fscmRestApi/resources/<api-version>` root; the fixed REST segment and resource paths are appended automatically. **Test SCM Connection** obtains an OAuth token and then verifies that the configured Fusion REST host is reachable; OAuth-only success is reported as a partial failure.

The `scm-lookup` Inventory Organization mode can search by Organization Name, Organization Code, or Organization ID. The selected field controls the Fusion query only; `msg.payload` still contains the complete matching organization response.

Other predefined lookup modes expose all required business keys directly: organization-scoped item, inventory, work definition/recipe, manufacturing work order/batch, and maintenance work order lookups require **Organization Code**; asset and work definition lookups also show **Item Number** where required; meter readings require **Meter Code** and use Fusion's asset-meter business-key finder. On-Hand Quantity optionally accepts **Subinventory Code**. Use Additional Filters only for extra narrowing criteria; filter names may contain letters, numbers, underscores, and dots.

Meter lookups follow all Fusion pages. Multi-page results are combined into one collection with complete `items` and `count`, `hasMore: false`, `offset: 0`, the original Fusion page-size `limit`, and no page-specific `links`.

Work-order child nodes and child-resource lookups encode resource IDs as individual URL path segments. Enter the original ID, without URL encoding; `.` and `..` are not valid resource IDs.

Smart Operations composites preserve a shared managed transaction when all fragments have the same owner. When owners differ, including a managed fragment joining an unmanaged fragment, the transformer commits each active source transaction before merging and removes the finalized references. Each commit covers that transaction's entire work and dequeued batch, including work outside this composite. Complete all required work on other branches before this boundary. Separate commits are not atomic together; later Fusion failures cannot undo them.

A commit or cleanup failure emits one Catch message with `SMO_COMPOSITE_COMMIT_FAILED`, combined retained originals, and `msg.smoTransactionResults`; no successful composite is emitted and the buffered fragment is removed. Each result records `outcome` (`committed`, `rolledBack`, or `unknown`), `closed` (connection cleanup succeeded), `failed`, and zero-based `originalIndexes` into `_aqOriginals`. Outcome history survives subsequent merges. Do not retry completed commits. Choose record recovery from these outcomes: rolled-back sources may already redeliver, and unknown outcomes require reconciliation. Recovery Enqueue does not select records automatically.

Invalid or expired transaction references reach Catch with `SMO_COMPOSITE_TRANSACTION_INVALID`. Invalid incoming input leaves the buffered fragment intact. An expired buffered fragment is removed, preserving combined originals on Catch and the incoming active reference for explicit rollback; the expired source outcome is `unknown`. Expiry or capacity eviction likewise sends an invalid buffered reference to Catch instead of emitting it. Inputs for each composite key are processed in order; other keys and their timers can proceed while a commit waits. Max Pending Entries bounds both stored composites and admitted input operations separately. Additional inputs reach Catch with `SMO_COMPOSITE_BUSY`, retaining their original payload and active reference without starting transaction work.

Pending fragments are held in memory and discarded when the node closes. Close waits for admitted operations and prevents late normal output; a hung database operation can delay that wait. With Retain Original enabled on Dequeue, a composite preserves every consumed original for recovery Enqueue, including a pending fragment superseded by a complete message. Missing originals make recovery fail explicitly. Identical originals remain separate records; retaining them increases buffered memory.

Fusion error responses retain their useful messages and payload structure, with credential fields and common authentication strings redacted from error payloads and Catch diagnostics.

Custom lookup mode accepts either a complete Fusion GET URL or a base resource
endpoint with optional ordered **Query Parameters**. Pasted query strings are
normalized into editable rows; `q`, `finder`, field selection, paging, empty
values, and repeated names all use the same mechanism. Parameterless GETs are
valid. Custom URLs must use the configured Fusion origin and API-version
resource root, cannot contain credentials or fragments, and do not follow
redirects. Custom rows are static configuration; use `fusion-request` GET
mappings for per-message parameter values.

Manufacturing child lookups expose **Work Order ID** and, for nested lines, **Operation ID**. These fields take Fusion `WorkOrderId` and `WorkOrderOperationId` resource IDs from parent lookup responses; they are distinct from the displayed batch number and operation sequence.

## Error Handling

Fusion SCM REST nodes route failures to Catch nodes and keep the normal output success-only. Catch messages include `msg.error = { message, code }`; when Fusion returns a validation response body, that text is promoted into `msg.error.message`, while the raw response body remains available in `msg.payload`.

## Smart Operations Transformer

The smo-transformer converts incoming telemetry or message data into structured Smart Operations event payloads. It starts with a neutral event type selection, supports 8 preset event types (CA_FAULT, CA_STATUS, CA_OPERATION_EXECUTION_START, etc.) that auto-populate field mappings when selected, plus custom event types. It reads nested input paths, can resolve event time from configurable source fields, writes to `msg.smoEvent` by default so the original `msg.payload` remains available, and includes a Mapping Assistant for sample payload path detection, composite-fragment array preview, and event preview. Clicking **Done** saves custom event types, field mappings, and composite configuration for the next edit.

> **Important:** The smo-transformer processes one message at a time. When dequeuing in batches or receiving arrays, place a **split** node (fixed length: 1) before the smo-transformer to ensure individual message processing.
>
> **Composite guardrails:** Incomplete composite fragments now require both `entityCode` and `eventTime` (to avoid key collisions), re-check required fields after merge, and enforce max pending age/count bounds even when stale timeout is disabled.
>
> **Invalid input:** Non-object and array payloads are treated as errors and can be routed to a Catch node.

**Typical flow:** `dequeue` → `split` (fixed length: 1) → `smart operations transformer` → `smart operations event`

See [Node Reference](https://github.com/oracle-samples/node-red-nodes/blob/v0.7.0/docs/node-reference.md) for full configuration details.

## Documentation

You can find the online documentation for the Oracle Internet of Things Platform at [docs.cloud.oracle.com](https://docs.oracle.com/en-us/iaas/Content/internet-of-things).

## Examples

The package includes four importable Node-RED examples:

- [AQ Meter Reading Submission](./examples/scm-meter-reading-asset-fallback.json) — enqueue sample data, dequeue it, and submit a meter reading
- [Conditional Asset Creation](./examples/conditional-asset-creation.json) — look up an installed base asset and create it only when no match is found
- [Inventory Transactions](./examples/inventory-transactions.json) — run a Miscellaneous Issue and a Subinventory Transfer independently
- [Sample Device Fault Handling](./examples/iot-fusion-maintenance-closed-loop.json) — inject sample device data, send Smart Operations events, and submit a shutdown command and a maintenance work order when a fault or high temperature is detected

The device-fault example uses injected sample data, not a live telemetry subscription. Command submission and work-order creation run on separate branches; the flow does not wait for confirmation that the device has shut down.

Examples can be imported directly into the Node-RED editor.
See [Import Examples Guide](https://github.com/oracle-samples/node-red-nodes/blob/v0.7.0/docs/import-examples.md).

## Contributing

This project welcomes contributions from the community. Before submitting a pull request, please [review our contribution guide](./CONTRIBUTING.md).

## Security

Please consult the [security guide](./SECURITY.md) for our responsible security vulnerability disclosure process.

## License

See [LICENSE](./LICENSE.txt).

## Disclaimer

Oracle and its affiliates do not provide any warranty whatsoever, express or implied, for
any software, material or content of any kind contained or produced within this
repository, and in particular specifically disclaim any and all implied warranties of
title, non-infringement, merchantability, and fitness for a particular purpose.
Furthermore, Oracle and its affiliates do not represent that any customary security
review has been performed with respect to any software, material or content contained or
produced within this repository. In addition, and without limiting the foregoing,
third parties may have posted software, material or content to this repository
without any review. Use at your own risk.

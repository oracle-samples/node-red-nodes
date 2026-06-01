# Node-RED SCM Nodes

This project provides a set of custom Node-RED nodes that integrate Oracle Fusion Cloud SCM with the OCI IoT Platform service. The nodes enable actions such as asset creation, meter readings, inventory transactions, SCM lookups, and telemetry-to-SMO transformation using Node-RED flows.

## Nodes

| Node | Description |
|------|-------------|
| **scm-server** | Oracle Fusion Cloud SCM authentication, connection, and proxy config. |
| **fusion-request** | Unified transaction node that starts in Custom mode and supports Create Asset, Meter Reading, Miscellaneous Transaction, and Subinventory Transfer presets. |
| **scm-lookup** | Unified lookup node that starts in Custom mode and supports Asset, Meter Reading, Organization ID, Item, Subinventory, On-Hand Quantity, Work Definition, and Manufacturing/Maintenance Work Order presets. |
| **smo-transformer** | Transforms telemetry data into structured SMO event payloads after an event type preset or custom event type is selected. |
| **smo-event** | Sends structured Smart Operations operational events to Fusion SCM. |
| **manufacturing-work-order** | Creates or updates discrete manufacturing work order headers. |
| **manufacturing-work-order-child** | Manages manufacturing work order operations, components, resources, serials, and progress/quantity reporting. |
| **maintenance-work-order** | Creates or updates maintenance work order headers. |
| **maintenance-work-order-child** | Manages maintenance work order operations, materials, resources, and cost-impacting operation transactions. |
| **create-asset** | Creates an Installed Base Asset. |
| **create-meter-reading** | Creates a Meter Reading. |
| **misc-transaction** | Creates a Miscellaneous Inventory Transaction with Custom, Receipt, and Issue modes. |
| **subinventory-quantity-transfer** | Creates a Subinventory Transfer. |
| **delete-transaction** | Deletes an SCM resource by mode-specific ID; starts in Custom mode and supports Asset, Meter, Misc, and Subinventory presets. |
| **get-ib-asset** | Retrieves an asset by Serial Number. |
| **get-meter-reading** | Retrieves meter readings by Asset Number. |
| **get-organization-id** | Retrieves an organization by name. |

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

### Required Node-RED Dependencies

Install inside the Node-RED directory (`~/.node-red`):

```bash
npm install axios
npm install https-proxy-agent
```

## Payload Mappings

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

`misc-transaction` Receipt and Issue modes set `TransactionTypeName` to the matching Fusion transaction type and leave `TransactionQuantity` unchanged. Use Custom mode when you want to map every transaction attribute yourself.
`misc-transaction` and `subinventory-quantity-transfer` include a `serials` mapping row for serialized inventory transactions; set it from a message property or `static JSON`.

## Error Handling

Fusion SCM REST nodes route failures to Catch nodes and keep the normal output success-only. Catch messages include `msg.error = { message, code }`; when Fusion returns a validation response body, that text is promoted into `msg.error.message`, while the raw response body remains available in `msg.payload`.

## SMO Transformer

The smo-transformer converts incoming telemetry or message data into structured SMO event payloads. It starts with a neutral event type selection, supports 8 preset event types (CA_FAULT, CA_STATUS, CA_OPERATION_EXECUTION_START, etc.) that auto-populate field mappings when selected, plus custom event types. It reads nested input paths, can resolve event time from configurable source fields, writes to `msg.smoEvent` by default so the original `msg.payload` remains available, and includes a Mapping Assistant for sample payload path detection, composite-fragment array preview, and event preview.

> **Important:** The smo-transformer processes one message at a time. When dequeuing in batches or receiving arrays, place a **split** node (fixed length: 1) before the smo-transformer to ensure individual message processing.
>
> **Composite guardrails:** Incomplete composite fragments now require both `entityCode` and `eventTime` (to avoid key collisions), re-check required fields after merge, and enforce max pending age/count bounds even when stale timeout is disabled.
>
> **Invalid input:** Non-object and array payloads are treated as errors and can be routed to a Catch node.

**Typical flow:** `dequeue` → `split` (fixed length: 1) → `smo-transformer` → `smo-event`

See [Node Reference](../docs/node-reference.md) for full configuration details.

## Documentation

You can find the online documentation for the Oracle Internet of Things Platform at [docs.cloud.oracle.com](https://docs.oracle.com/en-us/iaas/Content/internet-of-things).

## Examples

Example Node-RED flows are provided in the documentation showcasing different use cases:

- Enqueue → Dequeue → Create Meter Reading → If Not Found, Create Asset
- Conditional Asset Creation
- Inventory Transactions
- Closed-loop OCI IoT telemetry → Smart Operations event → Maintenance Work Order / raw command

Examples can be imported directly into the Node-RED editor.
See [Import Examples Guide](../docs/import-examples.md).

## Contributing

This project welcomes contributions from the community. Before submitting a pull request, please [review our contribution guide](../CONTRIBUTING.md).

## Security

Please consult the [security guide](../SECURITY.md) for our responsible security vulnerability disclosure process.

## License

See [LICENSE](../LICENSE.txt).

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

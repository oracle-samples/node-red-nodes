# Node-RED SCM Nodes

This project provides a set of custom Node-RED nodes that integrate Oracle Fusion Cloud SCM with the OCI IoT Platform service. The nodes enable actions such as asset creation, meter readings, inventory transactions, and SCM lookups using Node-RED flows.

---

## Nodes

| Node | Description |
|------|-------------|
| **scm-server** | Oracle Fusion Cloud SCM authentication, connection, and proxy config. |
| **fusion-request** | General transaction node (Create Asset, Meter Reading, Misc. Transaction, Subinventory Transfer, Custom). |
| **scm-lookup** | General lookup node (Asset, Meter Reading, Organization ID, Custom). |
| **create-asset** | Creates an Installed Base Asset. |
| **create-meter-reading** | Creates a Meter Reading. |
| **misc-transaction** | Creates a Miscellaneous Inventory Transaction (receipt or issue). |
| **subinventory-quantity-transfer** | Creates a Subinventory Transfer. |
| **delete-transaction** | Deletes a transaction by resource type. |
| **get-ib-asset** | Retrieves an asset by Serial Number. |
| **get-meter-reading** | Retrieves meter readings by Asset Number. |
| **get-organization-id** | Retrieves an organization by name. |

---

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

---

## Payload Mappings

All SCM transaction nodes use structured mapping rows with three source types:

| Source | Reads from | Value field |
|--------|-----------|-------------|
| **dequeued data** | `msg.dequeued.<value>` | Just the field name (e.g. `AssetNumber`) |
| **msg property** | `msg.<value>` | Full property path (e.g. `payload.someField`) |
| **static value** | Literal string | The constant value (e.g. `100100100`) |

---

## Documentation

You can find the online documentation for the Oracle Internet of Things Platform at [docs.cloud.oracle.com](https://docs.oracle.com/en-us/iaas/Content/internet-of-things).

---

## Examples

Example Node-RED flows are provided in the documentation showcasing different use cases:

- Enqueue → Dequeue → Create Meter Reading → If Not Found, Create Asset
- Conditional Asset Creation
- Inventory Transactions

Examples can be imported directly into the Node-RED editor.
See [Import Examples Guide](../docs/import-examples.md).

---

## Contributing

This project welcomes contributions from the community. Before submitting a pull request, please [review our contribution guide](../CONTRIBUTING.md).

---

## Security

Please consult the [security guide](../SECURITY.md) for our responsible security vulnerability disclosure process.

---

## License

See [LICENSE](../LICENSE.txt).

---

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
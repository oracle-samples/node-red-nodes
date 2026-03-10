# Node-RED DB Nodes

This project provides a set of custom Node-RED nodes that integrate the Oracle Database and Advanced Queues (AQ) with the OCI IoT Platform service. The nodes enable database operations such as executing SQL statements, enqueuing messages, dequeuing messages, and transactional processing using Node-RED flows.

## Nodes

| Node | Description |
|------|-------------|
| **db-connection** | Oracle Database authentication and connection config. Includes Test Connection button. |
| **begin-transaction** | Opens a managed connection with optional timeout for leak protection. |
| **end-transaction** | Commits and closes the connection. Shows elapsed time. |
| **dequeue** | Retrieves messages from Oracle AQ. Supports transactional and standalone modes. |
| **enqueue** | Publishes messages to Oracle AQ. Supports static payload or `msg.payload`. |
| **sql** | Executes SQL statements. Supports Editor or `msg.sql` as source. |

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
- Oracle Instant Client 23c

### Required Node-RED Dependencies

Install inside the Node-RED directory (`~/.node-red`):

```bash
npm install oracledb
```

> **NOTE:** Oracle Linux typically installs Instant Client into `/usr/lib/oracle/23/client64/lib` by default.

## Documentation

You can find the online documentation for the Oracle Internet of Things Platform at [docs.cloud.oracle.com](https://docs.oracle.com/en-us/iaas/Content/internet-of-things).

## Examples

Example Node-RED flows are provided in the documentation showcasing different use cases:

- Subscriber exists? → If Not, Create New Subscriber → If It Exists, Enqueue → Dequeue Example
- Multi-consumer queue and subscriber creation
- Transactional dequeue with rollback protection

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
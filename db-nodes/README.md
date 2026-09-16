# Node-RED DB Nodes

This project provides custom Node-RED nodes for Oracle Database and Advanced Queues (AQ). The nodes execute SQL statements, enqueue and dequeue messages, and manage database transactions in Node-RED flows.

## Nodes

| Node | Description |
|------|-------------|
| **db-connection** | Oracle Database authentication and connection config. Supports Basic and DB Token proxy users, TNS aliases or descriptors, and optional extracted wallet directories. Includes a Test Database Connection action directly below the visible fields on every editor tab. |
| **begin-transaction** | Opens a managed connection with optional timeout for leak protection. |
| **end-transaction** | Commits or rolls back and closes the connection. Shows elapsed time. |
| **dequeue** | Retrieves messages from Oracle AQ. Supports transactional mode and continuous mode with optional reconnect/retry controls. |
| **enqueue** | Publishes messages to Oracle AQ. Supports static payload or `msg.payload` (JSON/ADT editor includes `...` JSON editor helper). |
| **sql** | Executes SQL statements. Supports Editor or `msg.sql` as source (Binds Mapping JSONata rows include `...` expression editor helper). |

## Error Handling

Message-triggered DB nodes route failures through Catch nodes and keep the normal output success-only. Catch messages include `msg.error = { message, code }` using Oracle/node-oracledb error text when available, and DB nodes leave the current `msg.payload` unchanged on failure.

## Driver Mode

`db-connection` uses a process-wide node-oracledb driver mode. Thin and Thick remain selectable; an already-initialized Thick driver is reused. Restart Node-RED before switching modes or changing Oracle Client library settings.

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
- Oracle Client libraries supported by node-oracledb (required only when DB `Driver Mode` is `Thick`)

### Install the Node Package

Install the node package using the [installation guide](https://github.com/oracle-samples/node-red-nodes/blob/v0.7.0/docs/installation.md). Its dependencies are installed automatically; installing dependency libraries alone does not register the nodes.

> If your DB connections use `Driver Mode = Thin`, Oracle Instant Client is not required.
>
> Thin mode is pure JavaScript. Thick mode additionally loads a platform-specific binary and Oracle Client libraries; follow the [node-oracledb installation guide](https://node-oracledb.readthedocs.io/en/latest/user_guide/installation.html) for your operating system.

## Documentation

You can find the online documentation for the Oracle Internet of Things Platform at [docs.cloud.oracle.com](https://docs.oracle.com/en-us/iaas/Content/internet-of-things).

## Examples

The package includes one example: [AQ Subscriber and Message Processing](./examples/sql-enqueue-dequeue.json). It checks for a subscriber and creates it when missing; when the subscriber exists, it enqueues and dequeues a message. Run it again after creating the subscriber to exercise the enqueue/dequeue path.

The queue must already exist. Queue-creation SQL and the begin/end transaction pattern are documented separately in the shared guides; they are not additional example flows in this package.

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

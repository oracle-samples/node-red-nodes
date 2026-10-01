# Node-RED DB Nodes

This project provides custom Node-RED nodes for Oracle Database and Advanced Queues (AQ). The nodes execute SQL statements, enqueue and dequeue messages, and manage database transactions in Node-RED flows.

## Nodes

| Node | Description |
|------|-------------|
| **db-connection** | Oracle Database authentication and connection config. Supports Basic and DB Token proxy users, TNS aliases or descriptors, and optional extracted wallet directories. Includes a Test Database Connection action directly below the visible fields on every editor tab. |
| **begin-transaction** | Opens a managed connection with optional timeout for leak protection. |
| **end-transaction** | Commits or rolls back and closes the connection. Shows elapsed time. |
| **dequeue** | Retrieves messages from Oracle AQ with an optional database-side condition. Supports transactional mode and continuous mode with optional reconnect/retry controls. |
| **enqueue** | Publishes messages to Oracle AQ in Transactional or Auto-commit mode. Supports static payload or `msg.payload` (JSON/ADT editor includes `...` JSON editor helper). |
| **sql** | Executes SQL statements. Supports Editor or `msg.sql` as source (Binds Mapping JSONata rows include `...` expression editor helper). |

## Error Handling

On older Node-RED versions, read a supplied error code with `msg.error?.code || msg._error?.code`; not every external error includes a code.

Message-triggered DB nodes route failures through Catch nodes and keep the normal output success-only. Catch messages include `msg.error = { message, code }` using Oracle/node-oracledb error text when available, and DB nodes leave the current `msg.payload` unchanged on failure.

Continuous Dequeue reports terminal operational errors to a scoped Catch, including retry exhaustion. Connection diagnostics redact sensitive values before logging or returning connection-test results.

## AQ Transactions and Recovery

The first End commits or rolls back the entire managed transaction, including all records returned by a dequeue call. It does not wait for downstream records or branches. A later failure cannot reverse an earlier commit. An empty managed Dequeue finalizes previous transaction work and closes the connection without an output; failed DB work still forces rollback. Later SQL or default Enqueue calls carrying the closed reference fail rather than silently opening another connection.

Enqueue defaults to **Transactional** mode: it uses an incoming Begin Transaction, or opens and commits a standalone transaction when no transaction context exists. **Auto-commit** commits each input on a separate connection. It preserves the incoming transaction reference and does not finalize an active Begin Transaction, which still needs its own End.

Dequeue also exposes each payload as `msg.dequeued`. If processing replaces `msg.payload` but preserves `msg.dequeued`, a Function or Change node can select it for recovery. This is the same original payload reference, not an immutable snapshot: in-place changes can affect it, and aggregation does not preserve every contributing record there. For a recovery Enqueue after the source transaction ends, use **Auto-commit**. See [AQ recovery guidance](https://github.com/oracle-samples/node-red-nodes/blob/v0.7.1/docs/best-practice.md#recovering-a-dequeued-record) for array handling and memory use.

## Dequeue Filtering

Open **Filtering** to select **None** (default), **Editor**, or **Message**. Message reads `msg.dequeueCondition` on each input and is available only in Transactional mode. Oracle evaluates the condition during dequeue; the node does not fetch and discard unrelated messages or create subscriber rules. Use a nonblank, single-line SQL predicate supported by your queue and payload type, without `SELECT` or `WHERE`, up to 4000 UTF-8 bytes. Supply message conditions only from trusted flow configuration. An empty filtered result also finalizes a managed transaction, even if unmatched messages remain in the queue.

Browse and Locked read up to Batch Size one message at a time. Only the first read waits; remaining reads collect available messages without waiting or removing them. Locked holds locks until the transaction ends.

**Advanced** contains dequeue operation and wait/retry controls. Filtering opens automatically for a configured filter and its summary indicates when filtering is enabled.

## Driver Mode

`db-connection` uses a process-wide node-oracledb driver mode. Thin and Thick remain selectable; an already-initialized Thick driver is reused. Restart Node-RED before switching modes or changing Oracle Client library settings.

## Session Initialization

`db-connection` applies optional NLS fields followed by Advanced (restricted) `ALTER SESSION SET` statements; either can be configured independently. Initialization completes before returning the connection, and failures reject acquisition. Thin pools initialize new sessions without tags; Thick pools use an opaque tag covering all initialization statements and initialize new or differently tagged sessions. Already initialized pooled sessions are reused without rerunning initialization; standalone connections initialize on every open. Initialization does not reset later session changes made by flow SQL. Blank settings add no initialization callback or tag.

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

- Node-RED v2.0+
- Node.js v18+ (see the [dependency compatibility note](https://github.com/oracle-samples/node-red-nodes/blob/v0.7.1/docs/installation.md))
- npm
- Oracle Client libraries supported by node-oracledb (required only when DB `Driver Mode` is `Thick`)

### Install the Node Package

Install the node package using the [installation guide](https://github.com/oracle-samples/node-red-nodes/blob/v0.7.1/docs/installation.md). Its dependencies are installed automatically; installing dependency libraries alone does not register the nodes.

> If your DB connections use `Driver Mode = Thin`, Oracle Instant Client is not required.
>
> Thin mode is pure JavaScript. Thick mode additionally loads a platform-specific binary and Oracle Client libraries; follow the [node-oracledb installation guide](https://node-oracledb.readthedocs.io/en/latest/user_guide/installation.html) for your operating system.

## Documentation

You can find the online documentation for the Oracle Internet of Things Platform at [docs.cloud.oracle.com](https://docs.oracle.com/en-us/iaas/Content/internet-of-things).

## Examples

The package includes one example: [AQ Subscriber and Message Processing](./examples/sql-enqueue-dequeue.json). It checks for a subscriber and creates it when missing; when the subscriber exists, it enqueues and dequeues a message. Run it again after creating the subscriber to exercise the enqueue/dequeue path.

The queue must already exist. Queue-creation SQL and the begin/end transaction pattern are documented separately in the shared guides; they are not additional example flows in this package.

Examples can be imported directly into the Node-RED editor.
See [Import Examples Guide](https://github.com/oracle-samples/node-red-nodes/blob/v0.7.1/docs/import-examples.md).

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

# Node-RED SCM & DB Nodes

This project provides a set of custom Node-RED nodes that integrate the Oracle Database, Advanced Queues (AQ), and Oracle Fusion Cloud SCM with the OCI IoT Platform service.

## What's included:

- **db-nodes**
  - Database connection
  - SQL execution
  - AQ enqueue / dequeue

- **fusion-scm-nodes**
  - Create Asset
  - Create Meter Reading
  - Inventory transactions
  - Query resources

> Detailed node-level documentation is available in [Node Reference](./docs/node-reference.md).

## Quick Start

| Description | Resource |
|---------------------------------------------|:-----------:|
| Setup Oracle AQ (queue + subscriber using SQL) | [Guide](./docs/setup-sql.md) |
| Import examples into Node-RED | [Guide](./docs/import-examples.md) |
| Best practice for safely using custom nodes | [Guide](./docs/best-practice.md) |
| Detailed installation | [Guide](./docs/installation.md) |

## Installation

### 1. Install node-red-nodes from within your Node-RED environment.

### Cloning the Repository

Navigate to your Node-RED user directory (`~/.node-red`) and clone using on of the following methods:

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

### 2. Install dependencies.

#### Prerequisites

- Node-RED v3.0+
- Node.js v18+
- npm
- Oracle Instant Client 23c

#### Required Node-RED Dependencies

- These libraries must be installed inside your Node-RED user directory (`~/.node-red`):

```bash
cd ~/.node-red
npm install oracledb
npm install axios
npm install https-proxy-agent
```

- Install Oracle Instant Client (23c):

```bash
sudo dnf install oracle-instantclient-release-el8
sudo dnf install oracle-instantclient-basic
sudo dnf install oracle-instantclient-sqlplust
```

> **NOTE**: Oracle Linux typically installs Instant Client into the correct directory by default. If your system installs it elsewhere, make sure the directory follows this pattern:
`/usr/lib/oracle/23/client64/lib`

## Documentation

You can find the online documentation for the Oracle Internet of Things Platform at [docs.cloud.oracle.com](https://docs.oracle.com/en-us/iaas/Content/internet-of-things).

## Examples

Example Node-RED flows are provided in the documentation showcasing different use cases:

- Subscriber exists? → If Not, Create New Subscriber → If It Exists, Enqueue → Dequeue Example
- Enqueue → Dequeue → Create Meter Reading → If Not Found, Create Asset

Examples can be imported directly into the Node-RED editor.
See [Import Examples Guide](./docs/import-examples.md).

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
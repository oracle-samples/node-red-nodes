# Detailed Installation

This guide includes all installation steps and verification steps.

## Prerequisites

- Node-RED (v3.0+)
- Node.js (v18+)
- npm (comes with Node.js)
- Oracle Instant Client 23c

## 1.1 Required Installations (inside Node-RED environment)

- These libraries must be installed inside your Node-RED user directory (typically `~/.node-red`):

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

- Install Oracle Instant Client (23c):

```bash
sudo dnf install oracle-instantclient-release-el8
sudo dnf install oracle-instantclient-basic
sudo dnf install oracle-instantclient-sqlplus
```

> **NOTE**: Oracle Linux typically installs Instant Client into the correct directory by default. If your system installs it elsewhere, make sure the directory follows this pattern:
`/usr/lib/oracle/23/client64/lib`

## 1.2 Private Subnet Installation (Proxy + Registry Setup)

When running Node-RED on a private subnet not accessible to the internet, the npm proxy and registry must be configured to access external packages.

- Set npm registry:

```bash
npm config set registry https://internal-npm-registry-link
```

- Disable strict SSL:

```bash
npm config set strict-ssl false
```

- Configure npm proxy:

```bash
npm config set proxy http://user-proxy-host:port 
npm config set https-proxy http://user-proxy-host:port
```

## 1.3 Verify installation

1. Restart Node-RED by running:

```bash
sudo systemctl restart node-red
```

2. Confirm the nodes appear in the palette.

3. Import an example JSON flow and deploy it:
- See [Import Examples Guide](/docs/import-examples.md)

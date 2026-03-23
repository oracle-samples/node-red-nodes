# Detailed Installation

This guide includes all installation steps and verification steps.

## Prerequisites

- Node-RED (v3.0+)
- Node.js (v18+)
- npm (comes with Node.js)
- Oracle Instant Client 23c (for DB nodes)

## 1.1 Clone the Repository

Navigate to your Node-RED user directory (typically `~/.node-red`) and clone:

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

## 1.2 Install Dependencies

Install required npm packages inside your Node-RED user directory (`~/.node-red`):

```bash
cd ~/.node-red

# DB nodes
npm install oracledb

# SCM nodes
npm install axios
npm install https-proxy-agent

# OCI nodes (Notifications, Logging, Log Analytics, Object Storage, IoT Send Command)
npm install oci-sdk

# IoT nodes (Telemetry, Command)
npm install mqtt
```

Install Oracle Instant Client (23c) — required for DB nodes only:

```bash
sudo dnf install oracle-instantclient-release-el8
sudo dnf install oracle-instantclient-basic
sudo dnf install oracle-instantclient-sqlplus
```

> **NOTE:** Oracle Linux typically installs Instant Client into `/usr/lib/oracle/23/client64/lib` by default. To use a different path, set the `ORACLE_CLIENT_LIB` environment variable before starting Node-RED:
>
> ```bash
> export ORACLE_CLIENT_LIB=/path/to/your/instantclient
> ```

## 1.3 Private Subnet Installation (Proxy + Registry Setup)

When running Node-RED on a private subnet not accessible to the internet, the npm proxy and registry must be configured to access external packages.

Set npm registry:

```bash
npm config set registry https://internal-npm-registry-link
```

Disable strict SSL:

```bash
npm config set strict-ssl false
```

Configure npm proxy:

```bash
npm config set proxy http://user-proxy-host:port
npm config set https-proxy http://user-proxy-host:port
```

## 1.4 Verify Installation

1. Restart Node-RED:

```bash
sudo systemctl restart node-red
```

2. Confirm the nodes appear in the palette under their categories: oracle db, oracle fusion scm, and oci.

3. Import an example JSON flow and deploy it:
   - See [Import Examples Guide](./import-examples.md)

## 1.5 Which Dependencies Are Needed?

Not all dependencies are required. Install only what you need:

| If you're using... | Install |
|--------------------|---------|
| DB nodes only | `oracledb` + Oracle Instant Client |
| SCM nodes only | `axios`, `https-proxy-agent` |
| OCI Notifications, Logging, Log Analytics, Object Storage, or IoT Send Command | `oci-sdk` |
| IoT Telemetry or IoT Command | `mqtt` |
| Everything | All of the above |

# Detailed Installation

This guide includes all installation steps and verification steps.

## Prerequisites

- Node-RED (v3.0+)
- Node.js (v18+)
- npm (comes with Node.js)
- Oracle Client libraries supported by node-oracledb (required only when `db-connection` Driver Mode is set to `Thick`)

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

After cloning, install the node package, not only its dependency libraries. For the complete node set, run these commands from your Node-RED user directory (`~/.node-red`):

```bash
cd ~/.node-red/node-red-nodes
npm pack
cd ..
npm install ./node-red-nodes/node-red-nodes-0.7.1-rc.0.tgz
```

`npm pack` creates the `.tgz` archive; `npm install` installs it into the Node-RED user directory. Use the filename printed by `npm pack` if the package version differs, then restart Node-RED to load the installed nodes. This installs a node package; it does not import a flow through the editor.

The package manifest installs its dependencies automatically. Do not install the root package alongside standalone `db-nodes`, `oci-nodes`, or `fusion-scm-nodes` packages, because their node registrations overlap.

The dependency versions declared for the complete package are listed below for reference; installing these libraries alone does not register the custom nodes:

```bash
cd ~/.node-red

# DB nodes
npm install oracledb@^7.0.1

# SCM nodes
npm install axios@1.20.0
npm install https-proxy-agent@^7.0.6

# OCI nodes (Functions, native Streaming, Queue, Notifications, Logging, Object Storage, IoT control-plane nodes)
# OCI component dependencies are installed with the node package.

# OCI Managed Kafka producer and consumer
npm install @confluentinc/kafka-javascript@1.10.1

# IoT nodes (Telemetry, Command)
npm install mqtt@5.16.0
```

### Managed Kafka Client Install Reliability

`@confluentinc/kafka-javascript` includes native librdkafka bindings. Install it on the same operating system, architecture, libc, and Node.js ABI used to run Node-RED; do not copy its installed `node_modules` tree between different build and runtime images. Reinstall or rebuild it after changing Node.js. Supported platforms normally use an upstream prebuilt binary; other platforms require the native compiler prerequisites described in the [Confluent Kafka JavaScript installation guide](https://github.com/confluentinc/confluent-kafka-javascript#requirements).

### OCI Monitoring and signed API requests

**Credentials and permissions:** `oci-monitoring-publish`, `oci-monitoring-query`, and `oci-api-request` use `oci-config` and the existing OCI SDK dependency. Monitoring needs a region, metric compartment, and permission to publish or read the metrics. The signed API node needs permission for its target API. Test OCI Credentials checks authentication, not access to every service operation.

### Native OCI Streaming Setup

Streaming Out and Streaming In use OCI API signing through `oci-config`, not Kafka SASL credentials. Grant the principal the permissions required by the nodes in use:

```text
Allow group <group-name> to use stream-push in compartment <compartment-name>
Allow group <group-name> to use stream-pull in compartment <compartment-name>
```

For Instance Principal authentication, use the corresponding dynamic group instead of an IAM group. A broader existing `use streams` or `manage stream-family` grant may already include both operations. Use `stream-push` for Streaming Out and `stream-pull` for Streaming In when granting only the required data-plane access.

In the OCI Console, open the target stream and copy both its Stream OCID and Messages endpoint into `oci-streaming-config`. Use the HTTPS Messages endpoint shown for the stream, not the Kafka bootstrap server or the Streaming control-plane endpoint. Public stream pools use their public endpoint. Private stream pools require the Node-RED host to have VCN routing and DNS access to the private endpoint.

### Oracle Client Setup (Thick Mode Only)

Thin mode uses JavaScript and does not require Oracle Client libraries. Thick mode loads a platform-specific node-oracledb binary and compatible Oracle Client libraries. Follow the [node-oracledb installation guide](https://node-oracledb.readthedocs.io/en/latest/user_guide/installation.html) for your operating system, architecture, and database version; RPM package names and library paths differ between platforms and releases.

The node passes `ORACLE_CLIENT_LIB`, when set, to `initOracleClient` as `libDir`. On Linux, configure the system library search path before starting Node-RED; setting `libDir` alone does not replace that requirement. Do not copy installed native dependencies between incompatible runtime images.

Node-oracledb driver mode is process-wide. Later DB nodes reuse an initialized Thick driver; fully restart Node-RED before switching modes or changing Oracle Client library settings.

## 1.3 Install from Local `.tgz` in Palette Manager

When installing from a local file in **Node-RED Palette Manager**, you must use an **npm pack tarball that you generate yourself from this repo**.

Palette upload expects the archive to contain:

```text
package/package.json
package/...
```

GitHub source/release tarballs are not directly uploadable because they typically contain:

```text
node-red-nodes-<version>/...
```

If you upload a source tarball, Node-RED may fail with errors like `Module not found`.

### Required for Palette upload: create install artifact with `npm pack`

From the repository root:

```bash
npm pack
```

This creates a file like `node-red-nodes-0.7.0.tgz`. Upload that file in Palette Manager:

1. Open Node-RED editor.
2. Menu → **Manage palette** → **Install**.
3. Choose local file upload.
4. Select the `.tgz` generated by `npm pack`.

### Recovery: you only have a source/release tarball

If your downloaded archive is a source tarball, re-pack it with npm first.

Windows (PowerShell):

```powershell
cd $env:TEMP
tar -xf C:\Users\<you>\Downloads\node-red-nodes-0.7.0.tgz
cd .\node-red-nodes-0.7.0
npm pack
```

Windows (cmd):

```cmd
cd /d %TEMP%
tar -xf C:\Users\<you>\Downloads\node-red-nodes-0.7.0.tgz
cd node-red-nodes-0.7.0
npm pack
```

Linux/macOS:

```bash
cd /tmp
tar -xf ~/Downloads/node-red-nodes-0.7.0.tgz
cd node-red-nodes-0.7.0
npm pack
```

Upload the new npm-packed `.tgz` file via Palette Manager. This `npm pack` step is required for editor import.

## 1.4 Private Subnet Installation (Proxy + Registry Setup)

Use the registry and proxy approved for your network. Replace the placeholders below before running the commands:

```bash
npm config set registry "https://<registry-host>/<registry-path>"
npm config set proxy "http://<proxy-host>:<port>"
npm config set https-proxy "http://<proxy-host>:<port>"
npm config set strict-ssl true
```

Keep certificate verification enabled to protect package downloads and credentials from interception. If the registry or proxy uses an organizational CA, obtain the approved CA bundle from your administrator and configure `npm config set cafile "/path/to/approved-ca-bundle.pem"`. See [npm TLS configuration](https://docs.npmjs.com/cli/v10/using-npm/config#strict-ssl).

If your registry must be reached directly, set `NO_PROXY`/`no_proxy` for that registry host according to your network policy. Proxy bypass and certificate trust are separate settings.

## 1.5 Verify Installation

1. Fully restart the Node-RED process or container using the method appropriate to your installation. Deploying flows alone does not restart Node-RED.

2. Confirm the nodes appear in the palette under their categories: oracle db, oracle fusion scm, and oci.

3. Import an example JSON flow and deploy it:
   - See [Import Examples Guide](./import-examples.md)

## 1.6 Which Dependencies Are Needed?

Each installed package installs all dependencies declared in its own `package.json`, regardless of which nodes appear in a flow. To use fewer node families, install a standalone package instead of the root package. The runtime libraries used by each family are:

| Node family | Runtime libraries |
|--------------------|---------|
| DB nodes | `oracledb`, `oci-common`, `oci-identitydataplane` (+ Oracle Client libraries for Thick mode) |
| SCM nodes only | `axios`, `https-proxy-agent` |
| OCI Functions, native OCI Streaming, Queue, Notifications, Logging, Log Analytics, Object Storage, or IoT control-plane nodes | Individual `oci-*` SDK service packages used by these nodes |
| OCI Managed Kafka (OCI Streaming with Apache Kafka) producer or consumer | `@confluentinc/kafka-javascript@1.10.1` |
| ORDS request/poll nodes | No additional package beyond Node.js v18+ |
| IoT Telemetry or IoT Subscribe | `mqtt` |
| Everything | All of the above |

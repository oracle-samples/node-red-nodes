# Import Examples into Node-RED

This guide explains how to import the repository examples, including [db-nodes](../db-nodes/examples/sql-enqueue-dequeue.json), [fusion-scm-nodes](../fusion-scm-nodes/examples/scm-meter-reading-asset-fallback.json), and the closed-loop [OCI IoT to Fusion SCM example](../oci-nodes/examples/iot-fusion-scm-closed-loop.json), using the Node-RED editor.

## Import a JSON flow using the Node-RED editor

1. Open the Node-RED editor in your browser.
2. Click the **hamburger menu** (top-right corner).
3. Click **Import**.
4. Choose **Clipboard**.
5. Open the example `.json` file from this repository or copy the entire file and paste it into the text area.
6. Click **Import**.

## After importing, configure each node

### 1. DB Connection (config node)
- Open any DB node in the imported flow (Enqueue/Dequeue/SQL/Begin Transaction)
- Click the **DB Connection** dropdown
- Either select an existing DB Connection or click the pencil icon to configure a new one
- Use the **Test Connection** button to verify credentials before deploying

### 2. SCM Server (config node)
- Open any SCM node (Fusion Request/Create Asset/Create Meter Reading/SCM Lookup)
- Click the **SCM Server** dropdown
- Either select an existing SCM Server config or create one by clicking the pencil icon

### 3. OCI IoT / OCI Config nodes
- Open any OCI IoT node in the imported flow
- Configure **IoT Device** for MQTT subscriptions and **OCI Config** for control-plane REST calls such as raw command delivery
- Replace placeholder request/response endpoint topics and digital twin OCIDs with values from your OCI IoT environment

## Deploy the workflow and changes

1. Deploy the flow (top-right **Deploy** button)
2. Click the **Inject** node to trigger the flow
3. View results in the **Debug** sidebar (click the bug icon)

## Further Reference

For detailed field-by-field documentation on each node, see [Node Reference](./node-reference.md).

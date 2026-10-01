# Import Examples into Node-RED

This guide explains how to import the repository examples using the Node-RED editor.

## Available examples

- [AQ Subscriber and Message Processing](../db-nodes/examples/sql-enqueue-dequeue.json)
- [AQ Meter Reading Submission](../fusion-scm-nodes/examples/scm-meter-reading-asset-fallback.json)
- [Conditional Asset Creation](../fusion-scm-nodes/examples/conditional-asset-creation.json)
- [Inventory Transactions](../fusion-scm-nodes/examples/inventory-transactions.json)
- [Sample Device Fault Handling](../fusion-scm-nodes/examples/iot-fusion-maintenance-closed-loop.json)
- [Device Telemetry and Commands](../oci-nodes/examples/alert-shutdown-threshold.json)

## Import a JSON flow using the Node-RED editor

1. Open the Node-RED editor in your browser.
2. Click the **hamburger menu** (top-right corner).
3. Click **Import**.
4. Choose **Clipboard**.
5. Open the example `.json` file from this repository or copy the entire file and paste it into the text area.
6. Click **Import**.

## After importing, configure each node

Some examples combine DB, OCI, and Fusion SCM nodes. Install the root package for the complete set, or ensure all required standalone packages are installed without also installing the root package. Importing a flow does not create its database queues, OCI resources, or Fusion business data.

Open the flow's tab properties and setup comments before running. Replace sample identifiers, dates, numeric placeholders, credentials, and resource settings with values for a non-production environment. Inject buttons can send real requests that change data or control a device.

## Running the examples

- **AQ Subscriber and Message Processing:** see [setup, run steps and expected output](#aq-subscriber-and-message-processing) below.
- **AQ Meter Reading Submission:** enqueue sample data, dequeue it, and submit the reading. See [setup and missing-asset recovery](#aq-meter-reading-submission) below.
- **Conditional Asset Creation:** only a successful lookup with an empty `items` array proceeds to asset creation. A malformed response or reported lookup error stops the flow. Two simultaneous runs may both find no asset and try to create it; the lookup does not reserve the asset number.
- **Inventory Transactions:** test the issue and transfer branches independently. The issue uses a negative quantity; the transfer uses a positive quantity. Replace organization and source identifiers and confirm transaction requirements for your Fusion setup.
- **Sample Device Fault Handling:** a fault or temperature of at least 39 triggers the action branches; normal data sends a status event only. Missing required identity fields or invalid temperatures stop processing. Command, event, and work-order requests are independent, not one transaction; retrying the entire sample may repeat successful actions.
- **Device Telemetry and Commands:** this sample intentionally alerts below 30. A successful notification is followed by a shutdown command request. At 30 or above, no alert or command is sent. The subscription displays received commands; it does not implement device shutdown or send its response.

The AQ examples do not use a managed transaction block. Standalone dequeue commits message removal before downstream processing, so a later Fusion error does not put the message back on the queue.

### AQ Subscriber and Message Processing

Use the supplied [AQ example flow](../db-nodes/examples/sql-enqueue-dequeue.json). Its **Enqueue sample message** node already contains the sample payload, including `data.source: "test_data"`; you do not need to add it yourself.

| Step | Instructions |
|---|---|
| **Before running** | Select the same DB Connection on both SQL nodes, Enqueue and Dequeue. Use an existing, dedicated non-production multi-consumer JSON queue in the connected schema. The supplied queue and subscriber names are `JSON_QUEUE` and `MY_DEVICE`; if you change them, update the SQL statements and relevant node fields consistently. Creating the subscriber requires queue administration privileges. |
| **Run** | Click **Deploy**, open the Debug sidebar, and click **Run AQ example**. If the subscriber does not exist, the first run creates it and stops on that branch; click **Run AQ example** again to enqueue and dequeue the sample. If it already exists, the same run proceeds to enqueue and dequeue. |
| **Expected result** | **Dequeued message** displays the sample payload with `data.source: "test_data"`. The subscriber rule matches the supplied payload's `endpoint`; keep them consistent if you edit the sample. Other matching messages already queued for this consumer may be returned first. An empty dequeue produces no output. |
| **If it fails** | Inspect **AQ processing error**, which displays `msg.error`. Check the DB connection, matching queue/subscriber names, subscriber rule and permissions to create the subscriber. No dequeued output is expected on the run that only creates the subscriber. |

This example commits standalone dequeue consumption before downstream processing. It does not demonstrate managed rollback or batch-completion tracking.

### AQ Meter Reading Submission

**Setup:** Replace the sample reading date and configure the intended meter association in Fusion.

**Normal processing:** Enqueue the sample data, dequeue it, and submit the meter reading.

**Missing-asset recovery:** The specific HTTP 400 response `The value of the attribute AssetNumber isn't valid.` triggers an asset lookup. Creation proceeds only when the lookup succeeds with no items and `hasMore: false`. Other errors, existing assets, and incomplete lookup results go to Error Debug.

**After creation:** Associate the intended meter with the new asset in Fusion, then submit the reading again yourself. The flow does not configure the association or retry the reading automatically.

## Example error paths

Each example has a Catch node scoped to its processing nodes, connected to a named Error Debug node. The Debug sidebar shows `msg.error`, including the error message and any available code and source details, without dumping the whole input message. Inspect diagnostics before sharing them; error text can still contain application data.

These paths report catchable errors only. The meter-reading example additionally checks the specific error described above before looking up and creating an absent asset. It suppresses duplicate Catch deliveries for the same message ID for ten minutes, up to 1000 recent failures; this does not prevent races between different messages or across redeploys. Asset numbers containing apostrophes, semicolons, backslashes, or line breaks stop at Error Debug instead of being used in the recovery query.

The examples do not automatically retry failed requests or roll back transactions. Connection warnings and status-only failures may require checking the node status or runtime logs. If you add processing nodes to an example, update its Catch scope too. Add recovery only for a specifically identified error; when adding a managed database transaction, route failure through rollback before reporting it.

### 1. DB Connection (config node)
- Open any DB node in the imported flow (Enqueue/Dequeue/SQL/Begin Transaction)
- Click the **DB Connection** dropdown
- Either select an existing DB Connection or click the pencil icon to configure a new one
- Deploy the flow, then use **Test Database Connection** to verify the deployed credentials

### 2. SCM Server (config node)
- Open any SCM node (Fusion Request/Create Installed Base Asset/Create Meter Reading/SCM Lookup)
- Click the **SCM Server** dropdown
- Either select an existing SCM Server config or create one by clicking the pencil icon

### 3. OCI IoT / OCI Config nodes
- Open an OCI IoT node in the imported alert and shutdown flow
- Configure **IoT Device** for MQTT subscriptions and **OCI Config** for control-plane REST calls such as raw command delivery
- Replace placeholder request/response endpoint topics and digital twin OCIDs with values from your OCI IoT environment

## Deploy the workflow and changes

1. Deploy the flow (top-right **Deploy** button)
2. Click the **Inject** node to trigger the flow
3. View results in the **Debug** sidebar (click the bug icon)

## Further Reference

For detailed field-by-field documentation on each node, see [Node Reference](./node-reference.md).

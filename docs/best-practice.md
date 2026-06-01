# Best Practices for Safely Using Custom Nodes

This guide covers best practices for securely executing operations with these custom Node-RED nodes.

## Transactional Dequeue Processing

For reliable message processing where failed operations return messages to the queue, use the begin/end transaction pattern with dedicated commit and rollback paths:

```
begin transaction → dequeue → (processing) → end transaction (commit)
                                    ↓ (error)
                              catch → end transaction (rollback)
```

Messages stay locked on the queue until end-transaction commits. If the flow fails, the catch node routes to a rollback end-transaction and messages return to the queue automatically.
If your flow includes `enqueue`, keep it inside the same begin/end transaction path so the enqueue is only finalized on commit and is undone on rollback.

**Connection timeout:** Set a timeout on begin-transaction (e.g. 300 seconds) to auto-rollback stalled flows and prevent connection leaks.
When timeout is enabled, a reused transaction refreshes the timeout window to avoid stale-timer expiry in looping flows.
If end-transaction receives a timed-out transaction, it raises `Transaction timed out` through Catch instead of silently passing success.
If the same message hits end-transaction twice, the second pass is ignored with status `already ended` to prevent duplicate commit/rollback attempts.

**Standalone mode:** Dequeue can run without transaction nodes for simple use cases, but messages are auto-committed on dequeue and cannot be rolled back on downstream failure.
In Continuous mode, enable retry controls to survive transient DB outages without redeploying the flow.

**Dequeue mode:** Use Remove (default) for normal message consumption. Use Browse for monitoring queue contents without consuming. Use Locked only when you need to inspect before deciding to remove.

## Safe SQL Execution (SQL Node)

1. Always use bind variables instead of string concatenation to prevent SQL injection
2. Use least-privileged database users
3. Encrypt sensitive data
4. Validate inputs before executing

**autoCommit behavior:** The SQL node uses `autoCommit: false`. SELECT queries work as expected. Standalone DML statements (INSERT, UPDATE, DELETE) are not committed and will roll back when the standalone connection closes; for standalone DML, use a PL/SQL block with an explicit `COMMIT`. When the flow is inside begin/end transaction nodes, SQL uses `msg.transaction.connection` and the end-transaction node commits or rolls back the work.

**Dynamic SQL:** When SQL Source is set to `msg.sql`, the query is read from the incoming message at runtime. Validate the source of `msg.sql` to avoid executing untrusted SQL.
**Bind parity checks:** The SQL node fails fast when SQL placeholders and bind values do not match, with status `binds mismatch` before DB execute.

## SCM Payload Mappings

All SCM nodes that use payload mappings support structured mapping rows with typed source options:

| Source | Reads from | Value example |
|--------|-----------|---------------|
| **dequeued data** | `msg.dequeued.<value>` | `AssetNumber` (prefix added automatically) |
| **msg property** | `msg.<value>` | `payload.someField` |
| **static text** | Literal string | `NODE_RED` |
| **static number** | Numeric literal | `1` |
| **static boolean** | Boolean literal | Dropdown value: `true` or `false` |
| **static JSON** | Parsed JSON literal | `["SN1","SN2"]` — array/object for nested fields such as `serials` |
| **current timestamp** | Runtime clock | Generated ISO timestamp |

## OCI IoT Platform

**Authentication:** The IoT device nodes (`iot-config`, `iot-telemetry`, `iot-subscribe`) use MQTT device credentials — username/password or certificates. The cloud-side nodes (`iot-send-command`, `iot-get-content`, `iot-update-relationship`) use OCI user credentials via `oci-config`. These are separate auth contexts.

**Persistent sessions:** `iot-config` defaults to `clean: false` so the IoT Platform retains messages while the device is briefly offline. Keep this default for command/session reliability unless you explicitly need clean-session behavior.

**Subscription patterns:** In command subscriptions, use valid MQTT wildcards only (`+` for one full segment, `#` only as the final segment). Invalid patterns are rejected.

**Command responses:** The `iot-subscribe` node does not auto-acknowledge. To send a response after processing a command-topic message, publish explicitly using a separate `iot-telemetry` or `mqtt out` node on whatever response topic your protocol requires.

**Client ID uniqueness:** Only one MQTT connection per Client ID is allowed. If you use both iot-config and built-in MQTT nodes with the same Client ID, they will disconnect each other. Use different Client IDs or use one or the other.

## ORDS / IoT Data API

**Authentication:** ORDS nodes use OAuth client credentials through `ords-config`. This is separate from `oci-config` OCI signing and `db-connection` direct database login.

**Base URL ownership:** Keep the ORDS host/base path in `ords-config`. Request and polling nodes accept relative paths only so flows do not accidentally mix environments.

**Request defaults:** `oci-ords-request` defaults to Custom, so use it as a general ORDS request node. Select the IoT Data API presets only when those shortcuts match the endpoint you need.

**Polling volume:** Use `oci-ords-poll` for command status/response checks. When it follows `iot-send-command`, leave Record ID empty so the poll node reads `msg.recordId` from the command response. `Max Concurrent Polls` and `Max Queued Polls` live on `ords-config` as shared safety limits for all poll nodes using that profile; regular ORDS request nodes ignore them. Tune interval and timeout on each poll node for the workflow. Prefer shorter timeouts and bounded queues when many commands can be sent in bursts.

**Retries:** Treat `oci-ords-request` as a one-shot HTTP request. Use polling only when the workflow is genuinely asynchronous, such as waiting for command delivery status or response data.

## OCI Notifications

**Topic OCID vs dynamic routing:** Hardcode the Topic OCID in the editor for fixed alerting targets. Leave it empty and set `msg.topicOcid` for dynamic routing (e.g. different severity levels to different topics).

**Confirm subscriptions:** Email subscriptions require clicking a confirmation link before they receive messages. Test with a simple inject → notification flow to verify delivery.

## Connection Pool Recommendations

When using connection pooling on the db-connection config node:

| Setting | Suggested Value | Description |
|---------|----------------|-------------|
| Pool Min | 2 | Keeps connections warm for fast response |
| Pool Max | 10 | Prevents exhausting database sessions |
| Pool Increment | 1 | Grows the pool gradually under load |
| Queue Timeout | 60000 (ms) | Fails fast if no connection is available within 60 seconds |

Adjust based on your workload and database session limits.

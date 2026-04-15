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

**autoCommit behavior:** The SQL node uses `autoCommit: false`. In standalone mode, DML statements (INSERT, UPDATE, DELETE) are not committed and roll back when the SQL node closes its own connection. Inside a begin/end transaction flow, SQL reuses `msg.transaction.connection` and DML is committed or rolled back by end-transaction.

**Dynamic SQL:** When SQL Source is set to `msg.sql`, the query is read from the incoming message at runtime. Validate the source of `msg.sql` to avoid executing untrusted SQL.
**Bind parity checks:** The SQL node fails fast when SQL placeholders and bind values do not match, with status `binds mismatch` before DB execute.

## SCM Payload Mappings

All SCM transaction nodes use structured mapping rows with three source types:

| Source | Reads from | Value example |
|--------|-----------|---------------|
| **dequeued data** | `msg.dequeued.<value>` | `AssetNumber` (prefix added automatically) |
| **msg property** | `msg.<value>` | `payload.someField` |
| **static value** | Literal string | `100100100` |

## OCI IoT Platform

**Authentication:** The IoT device nodes (`iot-config`, `iot-telemetry`, `iot-command`) use MQTT device credentials — username/password or certificates. The cloud-side nodes (`iot-send-command`, `iot-update-relationship`) use OCI user credentials via `oci-config`. These are separate auth contexts.

**Persistent sessions:** `iot-config` defaults to `clean: false` so the IoT Platform retains messages while the device is briefly offline. Keep this default for command/session reliability unless you explicitly need clean-session behavior.

**Subscription patterns:** In command subscriptions, use valid MQTT wildcards only (`+` for one full segment, `#` only as the final segment). Invalid patterns are rejected.

**Command responses:** The iot-command node does not auto-acknowledge. To send a response after processing a command, publish explicitly using a separate `iot-telemetry` or `mqtt out` node on whatever response topic your protocol requires.

**Client ID uniqueness:** Only one MQTT connection per Client ID is allowed. If you use both iot-config and built-in MQTT nodes with the same Client ID, they will disconnect each other. Use different Client IDs or use one or the other.

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

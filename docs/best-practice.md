# Best Practices for Safely Using Custom Nodes

This guide covers best practices for securely executing operations with these custom Node-RED nodes.

## Transactional Dequeue Processing

Use the begin/end transaction pattern to keep database work on one connection:

```
begin transaction → dequeue → (processing) → end transaction (commit)
```

Messages stay locked on the queue until the database transaction commits or rolls back. External Fusion and OCI API calls are not part of that database transaction and cannot be undone by its rollback.

**Batch size:** Use **Batch Size 1** for this simple path. A larger dequeue batch emits separate messages sharing one transaction; the first Commit can remove the whole batch before the other messages finish processing. Larger batches need flow-level coordination so every message finishes before one End Transaction.

**Error recovery:** Wire a Catch scoped to the processing nodes to End Transaction configured for Rollback. Preserve `msg._dbTransaction`: this opaque runtime-local reference survives Catch, Function `node.send()`, and fan-out cloning without copying the Oracle connection. Do not include the rollback node in its own Catch scope. Do not log, publish, persist, or modify the reference, and do not construct replacement messages that discard it.

**Transaction branches**

Wait for every transaction branch to finish before sending one message to End. DB operations in one transaction run one at a time.

**Example:** Branch A reaches End while branch B is still in a Delay node. The transaction may close before B reaches SQL, causing B to fail with `DB_TRANSACTION_INACTIVE`.

End waits for active database work, not messages that may arrive later.

**Timeout and redeploy:** Cleanup waits for active DB work before rolling back and closing the connection. It cannot interrupt a stuck database call. Use finite AQ waits and database/network execution limits; a pool acquisition timeout only limits waiting for a connection, not SQL execution. Transaction references work only in the current runtime, not across restarts or other processes. External Fusion and OCI calls cannot be rolled back with the database transaction.

**Failed DB work**

Once a DB node reports a processing error, that managed transaction can only roll back. A subsequent Commit rolls back instead and reports `DB_TRANSACTION_ROLLBACK_REQUIRED`. Still route Catch to Rollback explicitly.

**Example:** An order insert succeeds, but its order-line insert fails. Commit rolls back the order insert rather than saving an incomplete order.

An invalid transaction reference does not mark a different transaction as failed.

If your flow includes `enqueue`, keep it inside the same begin/end transaction path so the enqueue is only finalized on commit and is undone on rollback.

**Connection timeout:** Set a timeout on begin-transaction (e.g. 300 seconds) to auto-rollback stalled flows and prevent connection leaks.

**Retrying a failed transaction:** DB nodes reject unknown, timed-out, closing, or ended references with `DB_TRANSACTION_INACTIVE`; a different DB Connection is rejected with `DB_TRANSACTION_CONFIG_MISMATCH`. Handle the error, finish any active transaction, then start a fresh message at Begin Transaction. Never delete a reference simply to bypass validation and run standalone. Custom code that manually constructs `msg.transaction` or operates directly on its connection is outside the managed lifecycle.

**Shutdown:** Begin Transaction closes open transactions before waiting for pending connection requests. Connections received after shutdown begins are closed without forwarding a message. Set bounded database connection and pool acquisition timeouts for predictable shutdown.

When timeout is enabled, a reused transaction refreshes the timeout window to avoid stale-timer expiry in looping flows.
End Transaction reports `inactive transaction` through Catch for a duplicate or stale reference rather than attempting another commit/rollback. Successful End output removes the reference and private handle. A message with neither still reports `no transaction` and passes through without DB work.

**Standalone mode:** Dequeue can run without transaction nodes for simple use cases, but messages are auto-committed on dequeue and cannot be rolled back on downstream failure.
In Continuous mode, enable retry controls to survive transient DB outages without redeploying the flow. The node applies retry controls to DB/dequeue errors. For multi-consumer queues, configure **Subscriber** with the AQ consumer name; `ORA-25231` means the consumer name is missing and stops immediately.

**Dequeue mode:** Use Remove (default) for normal message consumption. Use Browse for monitoring queue contents without consuming. Use Locked only when you need to inspect before deciding to remove.

## Safe SQL Execution (SQL Node)

1. Always use bind variables instead of string concatenation to prevent SQL injection
2. Use least-privileged database users
3. Encrypt sensitive data
4. Validate inputs before executing

**autoCommit behavior:** The SQL node uses `autoCommit: false`. SELECT queries work as expected. Standalone DML statements (INSERT, UPDATE, DELETE) are not committed and will roll back when the standalone connection closes; for standalone DML, use a PL/SQL block with an explicit `COMMIT`. When the flow is inside begin/end transaction nodes, SQL uses `msg.transaction.connection` and the end-transaction node commits or rolls back the work.

**Dynamic SQL:** When SQL Source is set to `msg.sql`, the query is read from the incoming message and executed as-is, with the configured DB user's privileges. The editor's single-statement guard does **not** apply to `msg.sql` (so it can run anonymous PL/SQL blocks). Only feed `msg.sql` from trusted flow logic — never from unvalidated HTTP, MQTT, or other external input — and pair it with least-privileged DB users.
**Bind parity checks:** The SQL node fails fast when SQL placeholders and bind values do not match, with status `binds mismatch` before DB execute.

## SCM Payload Sources and Mappings

Use **Mapped fields** when the flow should explicitly select, rename, type, or default individual Fusion attributes. Use **Entire msg.payload** when an upstream node already produces the complete Fusion request object. The modes are mutually exclusive: Mapped fields never falls back to the injected payload, and direct mode retains but ignores the mapping table so switching back does not lose its configuration.

Mapped fields requires at least one usable mapping for create, update, and other body-producing operations. An empty mapping table fails before OAuth token acquisition even when `msg.payload` contains an object. Parameterless `GET` and `DELETE` requests remain valid without mappings; use Entire msg.payload when a `GET` needs query parameters.

Direct payload mode validates and deep-copies a plain JSON-compatible object before OAuth token acquisition. Do not use it as a pass-through for arbitrary untrusted input; validate externally supplied data against the target Fusion API contract before it reaches the node. Node-specific mode defaults and required wrappers are added only to the copy.

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

Clicking **Done** saves structured mapping rows. Reopening a Fusion SCM, SQL, OCI Logging, or OCI Log Analytics node restores its saved mapping configuration.

## OCI IoT Platform

**Authentication:** The IoT device nodes (`iot-config`, `iot-telemetry`, `iot-subscribe`) use MQTT device credentials — username/password or certificates. The cloud-side nodes (`iot-send-command`, `iot-get-content`, `iot-update-relationship`) use OCI user credentials via `oci-config`. These are separate auth contexts.

**Persistent sessions:** `iot-config` defaults to `clean: false` so the IoT Platform retains messages while the device is briefly offline. Keep this default for command/session reliability unless you explicitly need clean-session behavior.

**Subscription patterns:** In command subscriptions, use valid MQTT wildcards only (`+` for one full segment, `#` only as the final segment). Invalid patterns are rejected.

**Command responses:** The `iot-subscribe` node does not auto-acknowledge. To send a response after processing a command-topic message, publish explicitly using a separate `iot-telemetry` or `mqtt out` node on whatever response topic your protocol requires.
This refers to an application-level command response; MQTT delivery acknowledgements are handled by the MQTT client according to QoS.

**Client ID uniqueness:** Only one MQTT connection per Client ID is allowed. If you use both iot-config and built-in MQTT nodes with the same Client ID, they will disconnect each other. Use different Client IDs or use one or the other.

## OCI Monitoring and signed API requests

**Monitoring:** Use `oci-monitoring-publish` for numeric measurements and `oci-monitoring-query` for MQL queries. Publish sends one data point per input, not a batch. Use Logging for detailed events rather than creating a separate metric series for every event.

A metric rejected by OCI goes to Catch even if the HTTP request succeeded. A successful publish does not mean the metric is immediately available to query; allow for this when checking results.

**Signed API requests:** Use `oci-api-request` when there is no dedicated node for an API that accepts OCI request signatures. Limit the endpoint and IAM permissions to the intended service. Input messages can change paths and methods, so validate untrusted input before it reaches the node.

The node does not follow redirects, retry requests, or fetch additional pages automatically. Buffer request bodies are unsupported; use a service-specific transfer node.

**Transaction and retry safety:** OCI calls are not rolled back with an Oracle DB transaction. If a write times out, it may still have succeeded. Check whether the operation completed before retrying.

## OCI Streaming, Kafka, Functions, and Queue

**Credential boundaries:** `oci-kafka-config` uses Kafka SASL credentials and does not use `oci-config`. Functions Invoke and Queue use OCI request signing through `oci-config`. Keep each identity least-privileged for only the topics, functions, or queues its flows require.

**Kafka consumer offsets:** Give each independently processed stream a stable Consumer Group ID. Consumers in the same group share partitions rather than each receiving every record. Existing committed offsets take precedence over Read From Beginning. Automatic mode records delivery by Kafka Consumer, not completion of downstream processing. For reliable workflows, use Manual mode and place Kafka Commit only after successful processing. Kafka commits the next offset, so one commit confirms that record and every earlier record in its partition.

**Kafka batch processing**

Preserve the commit metadata and commit once, after every record succeeds. Batch array output groups records from one partition. Manual mode waits for one batch per partition while other partitions and polling continue.

**Example:** A token for `[A, B, C]` commits all three even if the current payload contains only A. Splitting or editing the payload does not create separate commits.

Batch Limit counts records, not bytes; allow for their size and processing time. A single record containing an array is not automatically a batch.

**Kafka manual ownership:** Pending work pauses its own partition, not the native polling loop or other partitions. Revocation/reassignment invalidates old tokens without committing; never reuse a token after ownership changes. A late broker response can be ambiguous even if the node rejects it as stale. The installed native adapter requires record and next offsets within JavaScript's safe-integer range. Validate long-running processing and group handoff against your actual broker before production use.

**Streaming manual commits**

Preserve the commit metadata and commit once, after every record succeeds. Do not persist or log the metadata. A batch token commits every original record, even after splitting the payload.

Native Streaming In supports Individual and Batch array output. Automatic mode commits the previous read's position on the next read, without waiting for downstream success. Manual mode keeps one record or batch pending and sends heartbeats while waiting for Streaming Commit.

Loss of the cursor or partition reservation can invalidate the token and cause replay. If any records fail, leave the batch uncommitted; replay can repeat already completed actions, so those actions must tolerate duplicates.

**Streaming replay protection:** Manual consumers suppress records at or below their own successfully committed offset per partition, scoped to the running source's stream/group. Duplicate-only reads advance with the next read cursor, pause one second, and report persistent non-progress through Catch. This is not durable deduplication. Stop all affected consumers before resetting a group, and restart to clear local history. Oracle's native cursor-based commit protocol is retained; offsets are not incremented by the node. See [Oracle's consumer-group guidance](https://docs.oracle.com/en-us/iaas/Content/Streaming/Tasks/using_consumer_groups.htm).

**Streaming recovery:** Cursor expiry or reservation loss rejoins the same group and invalidates old manual tokens. Replay uses the group's committed position; if the group has expired, recovery starts from the oldest retained records. A retention-loss error stops for administrator review rather than silently skipping data or resetting all consumers. After an explicit group reset, redeploy affected sources. See [Oracle's retention and reservation troubleshooting](https://docs.oracle.com/en-us/iaas/Content/Streaming/Reference/troubleshootingstreaming.htm).

**Streaming polling:** Streaming In spaces read starts at least 210 ms apart, counting request and manual processing/commit time toward that interval instead of adding a fixed post-processing pause. Empty responses add a 1 second idle pause. Manual Individual mode remains single-record; Manual Batch array and Automatic modes can amortize requests over Batch Limit. Size batches for downstream latency and memory, not just maximum count. SDK retry/backoff remains active. Pacing is per node, not partition-aware or shared across runtimes. Oracle permits five GET requests per second per partition per consumer group; account for all consumers sharing that quota, including other runtimes. See [Oracle throttling guidance](https://docs.oracle.com/en-us/iaas/Content/Streaming/Reference/troubleshootingstreaming.htm).

**At-least-once processing:** Manual Kafka and Streaming commits allow replay when processing fails before the Commit node, but they do not provide exactly-once side effects. A worker can complete an external action and fail before committing, causing the record to be delivered again. Use idempotency keys or deduplication in downstream systems.

**Endpoint safety:** Copy Functions Invoke and Queue Messages endpoints from the OCI resource details. Both nodes require the service-specific HTTPS base endpoint and validate it before requesting OCI credentials. Do not build endpoints from untrusted message data.

**Queue acknowledgement:** Queue In does not auto-delete messages. Wire the successful processing path to Queue Ack, and leave failure paths unacknowledged so the message can become visible for redelivery. Keep `msg.ociQueue.receipt` with the message; it is opaque and should not be logged or persisted outside the processing path.

**Queue batch processing**

Process every entry before Queue Ack. Batch array output groups one receive response, with a matching receipt for each payload entry in `msg.ociQueue.records`. OCI may delete some messages and reject others; inspect `msg.ociQueue.ackResults` on the Catch path before retrying failed deletions.

**Example:** A and C are deleted, but B fails. Retry only B's deletion, keeping B's payload and receipt together and setting `messageCount` to `1`. Do not resend A and C.

If a network failure leaves results unknown, check the outcome or wait for redelivery; do not assume nothing was deleted. Finish processing before visibility expires; batching does not extend it. A single array-valued message is not automatically a batch.

**Queue shutdown:** Queue In cancels its own receive on redeploy without waiting for the full long-poll timeout or cancelling other nodes' requests. Cancellation cannot undo a receive already accepted by OCI; undelivered messages may remain hidden until visibility expires. Receiver retry/backoff belongs to Queue In rather than the SDK circuit breaker, and the SDK may print one shutdown-cancellation warning.

**Visibility timeout and dead-letter handling:** Set the visibility timeout longer than the expected downstream processing time. Configure maximum delivery attempts and a dead-letter queue on the OCI Queue resource for messages that repeatedly fail. Consumers must tolerate duplicate delivery because a worker can finish after visibility expires or lose its acknowledgement response.

**Detached functions**

Success means OCI accepted the request, not that the function finished or succeeded. Track completion separately, or use Synchronous mode if the next node needs the function's returned result.

**Example:** A report-generation function may still be running after detached acceptance. If the next node needs the report URL returned by the function, use Synchronous mode.

## ORDS / IoT Data API

**Authentication:** ORDS nodes use OAuth client credentials through `ords-config`. This is separate from `oci-config` OCI signing and `db-connection` direct database login.

**Base URL ownership:** Keep the ORDS host/base path in `ords-config`. Request and polling nodes accept relative paths only so flows do not accidentally mix environments.

**Request defaults:** `oci-ords-request` defaults to Custom, so use it as a general ORDS request node. Select the IoT Data API presets only when those shortcuts match the endpoint you need.

**Polling volume:** Use `oci-ords-poll` for command status/response checks. When it follows `iot-send-command`, leave Record ID empty so the poll node reads `msg.recordId` from the command response. `Max Concurrent Polls` and `Max Queued Polls` live on `ords-config` as shared safety limits for all poll nodes using that profile; regular ORDS request nodes ignore them. Tune interval and timeout on each poll node for the workflow. Prefer shorter timeouts and bounded queues when many commands can be sent in bursts.

**Retries:** Treat `oci-ords-request` as a one-shot HTTP request. Use polling only when the workflow is genuinely asynchronous, such as waiting for command delivery status or response data.

**Stopping polls:** Closing or redeploying `oci-ords-poll` prevents late responses from producing successful output. Pending polls detect closure with `ORDS_NODE_CLOSED`. This does not cancel an HTTP request already sent or close other nodes sharing the ORDS config.

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

**Transactions and pooling:** begin-transaction borrows one connection and holds it until the matching end-transaction (or the transaction timeout) runs. With pooling enabled, that connection is unavailable to the pool for the whole begin→end span, so flows that wait on slow or external steps between begin and end can exhaust a small pool — size `Pool Max` and `Queue Timeout` for the number of transactions you expect to run concurrently.

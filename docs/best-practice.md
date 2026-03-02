# Best Practices for Safely Using Custom Nodes

This guide covers best practices for securely executing operations with these custom Node-RED nodes.

## Transactional Dequeue Processing

For reliable message processing where failed operations return messages to the queue, use the begin/end transaction pattern:

`begin transaction` → `dequeue` → *(processing nodes)* → `end transaction`

Messages stay locked on the queue until end-transaction commits. If the flow fails at any point, the connection closes without commit and messages roll back to the queue automatically.

**Connection timeout:** Set a timeout on begin-transaction (e.g. 300 seconds) to auto-rollback stalled flows and prevent connection leaks.

**Standalone mode:** Dequeue can run without transaction nodes for simple use cases, but messages are auto-committed on dequeue and cannot be rolled back on downstream failure.

## Safe SQL Execution (SQL Node)

1. Always use bind variables instead of string concatenation to prevent SQL injection
2. Use least-privileged database users
3. Encrypt sensitive data
4. Validate inputs before executing

**autoCommit behavior:** The SQL node uses `autoCommit: false`. SELECT queries work as expected, but DML statements (INSERT, UPDATE, DELETE) are not committed and will roll back when the connection closes. For DML, use a PL/SQL block with an explicit `COMMIT`, or use begin/end transaction nodes.

**Dynamic SQL:** When SQL Source is set to `msg.sql`, the query is read from the incoming message at runtime. Validate the source of `msg.sql` to avoid executing untrusted SQL.

## SCM Payload Mappings

All SCM transaction nodes use structured mapping rows with three source types:

| Source | Reads from | Value example |
|--------|-----------|---------------|
| **dequeued data** | `msg.dequeued.<value>` | `AssetNumber` (prefix added automatically) |
| **msg property** | `msg.<value>` | `payload.someField` |
| **static value** | Literal string | `100100100` |

**Tips:**
- For the common dequeue → SCM flow, use **dequeued data** and just type the field name (e.g. `AssetNumber`)
- Use **msg property** when data comes from a source other than dequeue (HTTP input, function node, etc.)
- For constant values shared across all messages, use **static value**
- Rows can be reordered by dragging — put the most important fields at the top for readability
- Remove unused default rows to keep the mapping clean

## URL Override

All SCM nodes auto-compute the endpoint URL from the scm-server hostname and version. If you need to target a different endpoint (e.g. a sandbox environment or custom REST resource), check the **Override URL** checkbox and provide the full URL.

## Connection Pool Recommendations

When using connection pooling on the db-connection config node:

| Setting | Suggested Value | Description |
|---------|----------------|-------------|
| Pool Min | 2 | Keeps connections warm for fast response |
| Pool Max | 10 | Prevents exhausting database sessions |
| Pool Increment | 1 | Grows the pool gradually under load |
| Queue Timeout | 60000 (ms) | Fails fast if no connection is available within 60 seconds |

Adjust based on your workload and database session limits.
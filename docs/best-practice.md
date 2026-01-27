# Best Practices for Safely Using Custom Nodes

This guide covers best practices for securely executing operations with these custom Node-RED nodes.
- Safe SQL execution using the custom **SQL** node
- Safe SCM operations using **payload mappings**

## Things to keep in mind for safe SQL execution (SQL node)

1. Always validate inputs before executing the SQL statement
2. Use parameterized queries or prepared statements
3. Use least-privileged database users
4. Encrypt sensitive data

### Why this matters

The SQL node executes SQL text provided by the user. Improper usage can lead to security risks or unintended data exposure

## Things to keep in mind for SCM node payload mappings:

`key: value`

Where the value can be either:
1. Dequeued field reference (must use prefix msg.dequeued)
- Example: AssetNumber: msg.dequeued.AssetNumber
2. Manually entered literal value
- Example: `ItemNumber: 100100100`

If the flow uses a Dequeue node, values will be present under `msg.dequeued`.
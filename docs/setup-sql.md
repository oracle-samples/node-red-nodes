# Setup Oracle AQ (Queue + Subscriber using SQL)

This guide explains how to setup a multi-consumer Oracle AQ and subscriber.

In this guide you will:
1. Create a queue table
2. Create a queue
3. Start the queue
4. Create a subscriber (consumer) for multi-consumer dequeue flows

> **Important:** Be mindful of what schema the AQ is created in. Objects will be created under the schema of the user running these SQL statements.
>
> **Important:** Subscribers are case-sensitive!

## Creating a multi-consumer queue and subscriber

### Step 1 — Create a queue table and queue

Creates queue table `JSON_QUEUE_TAB` and queue `JSON_QUEUE` which will be referenced in various nodes.

```sql
BEGIN
  DBMS_AQADM.CREATE_QUEUE_TABLE(
    queue_table        => 'JSON_QUEUE_TAB',
    queue_payload_type => 'JSON',
    multiple_consumers => TRUE
  );

  DBMS_AQADM.CREATE_QUEUE(
    queue_name  => 'JSON_QUEUE',
    queue_table => 'JSON_QUEUE_TAB'
  );

  DBMS_AQADM.START_QUEUE(
    queue_name => 'JSON_QUEUE'
  );
END;
/
```

### Step 2 — Create subscriber

This section shows two subscriber examples:
- ConsumerA: a subscriber without rules (receives all messages)
- HIGH_TEMP: a subscriber with a rule that only receives messages where `temp` > 80

#### Example A - Create a subscriber called `ConsumerA` without any rules.

```sql
BEGIN
  DBMS_AQADM.ADD_SUBSCRIBER(
    queue_name => 'JSON_QUEUE',
    subscriber => SYS.AQ$_AGENT('ConsumerA', NULL, NULL)
  );
END;
/
```

#### Example B - Create a subscriber called `HIGH_TEMP` with a rule

Creates a subscriber called HIGH_TEMP with a rule that checks the JSON payload and only matches messages where `temp` is greater than 80.
> **NOTE**: This rule only works if `temp` is actually present in the JSON payload being enqueued.

```sql
BEGIN
  DBMS_AQADM.ADD_SUBSCRIBER(
    queue_name => 'JSON_QUEUE',
    subscriber => SYS.AQ$_AGENT('HIGH_TEMP', NULL, NULL),
    rule       => q'[ JSON_VALUE(tab.user_data, '$.temp' RETURNING NUMBER) > 80 ]'
  );
END;
/
```

### Step 3 - How to use these in Node-RED nodes

#### Entering queue name
When configuring nodes (Enqueue/Dequeue/SQL) you'll need to reference the queue inside the `Queue Name` field using:
- `SCHEMA.JSON_QUEUE`

#### Enter subscriber (consumer) name
After creating a subscriber, you can pass the name inside either:
- Enqueue Node: `Recipients` field which delivers the message only the subscribers entered. Leave empty if you want the message to be delivered to all subscribers of the queue
- Dequeue Node: `Subscriber` field will dictate who to dequeue as
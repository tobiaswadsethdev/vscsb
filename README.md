# Azure Service Bus Explorer for VS Code

A Visual Studio Code extension for browsing and managing Azure Service Bus queues, topics, subscriptions, and their messages including dead-letter queues.

## Features

- **Browse Service Bus Resources**: Navigate through your Azure Service Bus namespaces, queues, topics, and subscriptions
- **Message Counts at a Glance**: View active and dead-letter message counts directly in the tree view with the format `[active|dead-letter]`
- **Total Message Summary**: See total active and dead-letter messages across all queues and topics at the namespace level
- **Peek Messages**: Preview messages without removing them from queues or subscriptions
- **Dead-Letter Queue Management**:
  - View dead-letter messages with failure reasons
  - Resubmit failed messages back to the main queue/topic
  - Delete individual messages
  - Purge entire dead-letter queues
- **Message Details**: View complete message content, headers, and properties
- **Multiple Authentication Methods**:
  - Azure AD authentication
  - Connection string authentication

## Installation

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "Azure Service Bus Explorer"
4. Click Install

## Getting Started

### Adding a Namespace

1. Click the "+" icon in the Azure Service Bus Explorer view
2. Enter your Service Bus namespace:
   - Namespace name (e.g., `my-servicebus`)
   - Full namespace URL (e.g., `my-servicebus.servicebus.windows.net`)
   - Connection string (for connection string authentication)

### Authentication

#### Azure AD Authentication

The extension uses your Azure credentials from VS Code. Make sure you're signed in to Azure through VS Code.

#### Connection String Authentication

Provide a connection string when adding a namespace. The connection string should include:

- Endpoint
- SharedAccessKeyName
- SharedAccessKey

## Understanding the Tree View

The extension displays your Service Bus resources in a hierarchical tree:

```text
[10|2] Total Messages                    ← Total active|dead-letter messages
├─ Queues
│  ├─ [5|1] my-queue                     ← Queue with message counts
│  │  ├─ [5] Active Messages
│  │  └─ [1] Dead Letter Queue
├─ Topics
│  ├─ [5|1] my-topic                     ← Topic with aggregated counts from all subscriptions
│  │  ├─ [3|1] subscription-1            ← Subscription with message counts
│  │  │  ├─ [3] Active Messages
│  │  │  └─ [1] Dead Letter Queue
│  │  └─ [2|0] subscription-2
│  │     ├─ [2] Active Messages
│  │     └─ [0] Dead Letter Queue
```

### Message Count Format

- **`[active|dead-letter]`**: Format used for queues, topics, subscriptions, and namespace summary
- **`[count]`**: Format used for Active Messages and Dead Letter Queue folders
- All counts are displayed on the left side for better readability

## Commands

### Namespace Management

- **Add Namespace**: Add a new Service Bus namespace
- **Remove Namespace**: Remove a namespace from the explorer
- **Refresh**: Refresh the entire tree or a specific node

### Message Operations

- **Peek Messages**: Preview messages without consuming them (max 50 messages)
- **View Message**: Open a message in a detailed view showing:
  - Message body (formatted JSON or text)
  - System properties (MessageId, EnqueuedTime, etc.)
  - Application properties
  - Dead-letter information (if applicable)

### Dead-Letter Queue Operations

- **Resubmit Message**: Send a dead-letter message back to the original queue/topic
  - Preserves message body and properties
  - Adds metadata about the resubmission
  - Removes message from dead-letter queue
- **Delete Message**: Permanently delete a message from the dead-letter queue
- **Purge Dead Letter Queue**: Delete all messages from a dead-letter queue

## Usage Examples

### Viewing Messages

1. Navigate to a queue or subscription
2. Expand the "Active Messages" or "Dead Letter Queue" node
3. Messages are peeked automatically (up to 50)
4. Click on a message to view its details

### Resubmitting Dead-Letter Messages

1. Navigate to a Dead Letter Queue
2. Find the message you want to resubmit
3. Right-click the message
4. Select "Resubmit Message"
5. The message will be sent back to the main queue/topic

### Purging Dead-Letter Messages

1. Navigate to a Dead Letter Queue
2. Right-click on "Dead Letter Queue"
3. Select "Purge Dead Letter Queue"
4. Confirm the action
5. All messages will be permanently deleted

## Requirements

- Visual Studio Code 1.85.0 or higher
- Azure Service Bus namespace
- Appropriate permissions to access Service Bus resources

## Extension Settings

Namespaces are persisted in VS Code's global state and will be available across sessions.

## Known Limitations

- Maximum 50 messages can be peeked at a time
- Session-enabled queues/subscriptions may have limited functionality for some operations
- Large message bodies may take time to load

## Troubleshooting

### Authentication Issues

- Ensure you're signed in to Azure through VS Code
- Verify your Azure credentials have appropriate permissions
- For connection strings, verify the format is correct

### Can't See Messages

- Verify the queue/subscription actually has messages
- Check permissions on the Service Bus namespace
- Try refreshing the node

### Resubmit/Delete Operations Fail

- Some operations may not work on session-enabled entities
- Verify you have sufficient permissions
- Check if the message still exists in the queue

## Contributing

Issues and feature requests can be reported at the [GitHub repository](https://github.com/tobiaswadsethdev/vscsb).

## Release Notes

### 1.0.2

- Moved message counts to the left side for better readability
- Added total message summary at namespace level
- Topics now show aggregated message counts from all subscriptions
- Improved message count display format `[active|dead-letter]`

### 1.0.0

- Initial release
- Browse queues, topics, and subscriptions
- Peek messages
- Dead-letter queue management
- Resubmit and delete operations

## License

See LICENSE file for details.

---

**Enjoy managing your Azure Service Bus resources!**

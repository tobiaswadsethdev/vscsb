import {
    ServiceBusClient,
    ServiceBusAdministrationClient,
    ServiceBusReceivedMessage,
    ServiceBusSender
} from '@azure/service-bus';
import { TokenCredential } from '@azure/identity';
import { getAzureCredential } from './authProvider';
import Long from "long";

export interface QueueInfo {
    name: string;
    activeMessageCount: number;
    deadLetterMessageCount: number;
}

export interface TopicInfo {
    name: string;
    subscriptionCount?: number;
    activeMessageCount?: number;
    deadLetterMessageCount?: number;
}

export interface SubscriptionInfo {
    name: string;
    topicName: string;
    activeMessageCount: number;
    deadLetterMessageCount: number;
}

/**
 * Recursively convert AMQP types to plain JavaScript types.
 * This handles AmqpMap, Date objects, datetime-offset, Long, and other special types that
 * can't be serialized by the Service Bus SDK.
 */
function convertToPlainObject(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
        return obj;
    }

    // Handle Date objects
    if (obj instanceof Date) {
        return obj.toISOString();
    }

    // Handle Buffer
    if (Buffer.isBuffer(obj)) {
        return obj;
    }

    // Handle arrays
    if (Array.isArray(obj)) {
        return obj.map(item => convertToPlainObject(item));
    }

    // Handle objects (including AmqpMap and other special types)
    if (typeof obj === 'object') {
        const objAsAny = obj as Record<string, unknown>;

        // Check if it's an AMQP datetime-offset (used by Azure Service Bus)
        // Format: { type: {...}, value: {0:..., 1:..., ...7:...}, descriptor: { value: "com.microsoft:datetime-offset" } }
        const descriptor = objAsAny.descriptor as Record<string, unknown> | undefined;
        if (descriptor?.value === 'com.microsoft:datetime-offset' && objAsAny.value) {
            try {
                const bytes = objAsAny.value as Record<number, number>;
                // Convert bytes to a BigInt (big-endian)
                let ticks = BigInt(0);
                for (let i = 0; i < 8; i++) {
                    ticks = (ticks << BigInt(8)) | BigInt(bytes[i] || 0);
                }
                // Convert ticks to milliseconds since Unix epoch
                // .NET ticks epoch is 0001-01-01, Unix epoch is 1970-01-01
                // Difference is 621355968000000000 ticks
                const ticksToUnixEpoch = BigInt('621355968000000000');
                const ticksPerMillisecond = BigInt(10000);
                const unixMillis = Number((ticks - ticksToUnixEpoch) / ticksPerMillisecond);
                return new Date(unixMillis).toISOString();
            } catch (e) {
                console.error('[ServiceBus] Failed to parse datetime-offset:', e);
            }
        }

        // Check if it's a Long number (used for timestamps/sequence numbers)
        if ('low' in objAsAny && 'high' in objAsAny && !('type' in objAsAny)) {
            try {
                const num = (objAsAny.low as number) + (objAsAny.high as number) * 0x100000000;
                // Check if it looks like a timestamp (milliseconds since epoch)
                if (num > 1000000000000 && num < 2000000000000) {
                    return new Date(num).toISOString();
                }
                return num;
            } catch {
                // Fall through to regular object handling
            }
        }

        // Check if it's a Map-like object (AmqpMap)
        if (typeof objAsAny.forEach === 'function' && obj.constructor?.name?.includes('Map')) {
            const plainObj: Record<string, unknown> = {};
            (obj as Map<string, unknown>).forEach((value, key) => {
                plainObj[String(key)] = convertToPlainObject(value);
            });
            return plainObj;
        }

        // Check if it has a toJSON method
        if (typeof objAsAny.toJSON === 'function') {
            return convertToPlainObject(objAsAny.toJSON());
        }

        // Regular object - recursively convert all properties
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(objAsAny)) {
            result[key] = convertToPlainObject(objAsAny[key]);
        }
        return result;
    }

    // Primitives (string, number, boolean) - return as-is
    return obj;
}

// Check if the input looks like a connection string
function isConnectionString(input: string): boolean {
    return input.includes('Endpoint=sb://') && input.includes('SharedAccessKey');
}

// Extract namespace from connection string
function getNamespaceFromConnectionString(connectionString: string): string {
    const match = connectionString.match(/Endpoint=sb:\/\/([^.]+)\.servicebus\.windows\.net/);
    return match ? `${match[1]}.servicebus.windows.net` : '';
}

export class ServiceBusService {
    private clients: Map<string, ServiceBusClient> = new Map();
    private adminClients: Map<string, ServiceBusAdministrationClient> = new Map();
    private connectionStrings: Map<string, string> = new Map();
    private credential: TokenCredential;

    constructor() {
        this.credential = getAzureCredential();
    }

    /**
     * Register a connection string for a namespace
     */
    registerConnectionString(connectionString: string): string {
        const namespace = getNamespaceFromConnectionString(connectionString);
        if (namespace) {
            this.connectionStrings.set(namespace, connectionString);
            // Clear any existing clients for this namespace to force reconnection
            this.clients.delete(namespace);
            this.adminClients.delete(namespace);
        }
        return namespace;
    }

    /**
     * Check if namespace uses connection string
     */
    hasConnectionString(namespace: string): boolean {
        return this.connectionStrings.has(namespace);
    }

    private getClient(namespace: string): ServiceBusClient {
        let client = this.clients.get(namespace);
        if (!client) {
            const connectionString = this.connectionStrings.get(namespace);
            if (connectionString) {
                console.log(`[ServiceBus] Creating client for ${namespace} using connection string`);
                client = new ServiceBusClient(connectionString);
            } else {
                const fullyQualifiedNamespace = namespace.includes('.servicebus.windows.net')
                    ? namespace
                    : `${namespace}.servicebus.windows.net`;
                console.log(`[ServiceBus] Creating client for ${fullyQualifiedNamespace} using Azure AD`);
                client = new ServiceBusClient(fullyQualifiedNamespace, this.credential);
            }
            this.clients.set(namespace, client);
        }
        return client;
    }

    private getAdminClient(namespace: string): ServiceBusAdministrationClient {
        let client = this.adminClients.get(namespace);
        if (!client) {
            const connectionString = this.connectionStrings.get(namespace);
            if (connectionString) {
                console.log(`[ServiceBus] Creating admin client for ${namespace} using connection string`);
                client = new ServiceBusAdministrationClient(connectionString);
            } else {
                const fullyQualifiedNamespace = namespace.includes('.servicebus.windows.net')
                    ? namespace
                    : `${namespace}.servicebus.windows.net`;
                console.log(`[ServiceBus] Creating admin client for ${fullyQualifiedNamespace} using Azure AD`);
                client = new ServiceBusAdministrationClient(fullyQualifiedNamespace, this.credential);
            }
            this.adminClients.set(namespace, client);
        }
        return client;
    }

    async listQueues(namespace: string): Promise<QueueInfo[]> {
        const adminClient = this.getAdminClient(namespace);
        const queues: QueueInfo[] = [];

        for await (const queue of adminClient.listQueues()) {
            const runtimeProps = await adminClient.getQueueRuntimeProperties(queue.name);
            queues.push({
                name: queue.name,
                activeMessageCount: runtimeProps.activeMessageCount,
                deadLetterMessageCount: runtimeProps.deadLetterMessageCount
            });
        }

        return queues;
    }

    async listTopics(namespace: string): Promise<TopicInfo[]> {
        const adminClient = this.getAdminClient(namespace);
        const topics: TopicInfo[] = [];

        for await (const topic of adminClient.listTopics()) {
            const runtimeProps = await adminClient.getTopicRuntimeProperties(topic.name);

            // Calculate total messages across all subscriptions
            let totalActive = 0;
            let totalDeadLetter = 0;

            for await (const subscription of adminClient.listSubscriptions(topic.name)) {
                const subRuntimeProps = await adminClient.getSubscriptionRuntimeProperties(
                    topic.name,
                    subscription.subscriptionName
                );
                totalActive += subRuntimeProps.activeMessageCount;
                totalDeadLetter += subRuntimeProps.deadLetterMessageCount;
            }

            topics.push({
                name: topic.name,
                subscriptionCount: runtimeProps.subscriptionCount,
                activeMessageCount: totalActive,
                deadLetterMessageCount: totalDeadLetter
            });
        }

        return topics;
    }

    async listSubscriptions(namespace: string, topicName: string): Promise<SubscriptionInfo[]> {
        const adminClient = this.getAdminClient(namespace);
        const subscriptions: SubscriptionInfo[] = [];

        for await (const subscription of adminClient.listSubscriptions(topicName)) {
            const runtimeProps = await adminClient.getSubscriptionRuntimeProperties(
                topicName,
                subscription.subscriptionName
            );
            subscriptions.push({
                name: subscription.subscriptionName,
                topicName: topicName,
                activeMessageCount: runtimeProps.activeMessageCount,
                deadLetterMessageCount: runtimeProps.deadLetterMessageCount
            });
        }

        return subscriptions;
    }

    async peekActiveMessages(
        namespace: string,
        queueName?: string,
        topicName?: string,
        subscriptionName?: string,
        maxMessages: number = 50
    ): Promise<ServiceBusReceivedMessage[]> {
        const client = this.getClient(namespace);
        let receiver;

        if (queueName) {
            receiver = client.createReceiver(queueName, { receiveMode: 'peekLock' });
        } else if (topicName && subscriptionName) {
            receiver = client.createReceiver(topicName, subscriptionName, { receiveMode: 'peekLock' });
        } else {
            throw new Error('Either queueName or both topicName and subscriptionName must be provided');
        }

        try {
            // Add timeout wrapper to prevent hanging
            const timeoutPromise = new Promise<ServiceBusReceivedMessage[]>((_, reject) => {
                setTimeout(() => reject(new Error('Peek operation timed out after 30 seconds')), 30000);
            });

            // Always peek from sequence number 1 to get messages from the beginning
            const messages = await Promise.race([
                receiver.peekMessages(maxMessages, { fromSequenceNumber: Long.fromInt(1) }),
                timeoutPromise
            ]);
            return messages;
        } finally {
            await receiver.close().catch(() => { /* ignore close errors */ });
        }
    }

    async peekDeadLetterMessages(
        namespace: string,
        queueName?: string,
        topicName?: string,
        subscriptionName?: string,
        maxMessages: number = 50
    ): Promise<ServiceBusReceivedMessage[]> {
        const client = this.getClient(namespace);
        let receiver;

        if (queueName) {
            console.log(`[ServiceBus] Creating DLQ receiver for queue: ${queueName}`);
            receiver = client.createReceiver(queueName, {
                receiveMode: 'peekLock',
                subQueueType: 'deadLetter'
            });
        } else if (topicName && subscriptionName) {
            console.log(`[ServiceBus] Creating DLQ receiver for topic: ${topicName}, subscription: ${subscriptionName}`);
            receiver = client.createReceiver(topicName, subscriptionName, {
                receiveMode: 'peekLock',
                subQueueType: 'deadLetter'
            });
        } else {
            throw new Error('Either queueName or both topicName and subscriptionName must be provided');
        }

        try {
            // Add timeout wrapper to prevent hanging
            const timeoutPromise = new Promise<ServiceBusReceivedMessage[]>((_, reject) => {
                setTimeout(() => reject(new Error('Peek operation timed out after 30 seconds')), 30000);
            });

            console.log(`[ServiceBus] Calling peekMessages with maxMessages: ${maxMessages}`);

            // Always peek from sequence number 1 to get messages from the beginning
            // This is important because peekMessages maintains an internal cursor
            const messages = await Promise.race([
                receiver.peekMessages(maxMessages, { fromSequenceNumber: Long.fromInt(1) }),
                timeoutPromise
            ]);

            console.log(`[ServiceBus] peekDeadLetterMessages returned ${messages.length} messages`);
            return messages;
        } catch (error) {
            console.error(`[ServiceBus] Error in peekDeadLetterMessages:`, error);
            throw error;
        } finally {
            await receiver.close().catch(() => { /* ignore close errors */ });
        }
    }

    async receiveDeadLetterMessages(
        namespace: string,
        queueName?: string,
        topicName?: string,
        subscriptionName?: string,
        maxMessages: number = 50
    ): Promise<ServiceBusReceivedMessage[]> {
        const client = this.getClient(namespace);
        let receiver;

        if (queueName) {
            receiver = client.createReceiver(queueName, {
                receiveMode: 'peekLock',
                subQueueType: 'deadLetter'
            });
        } else if (topicName && subscriptionName) {
            receiver = client.createReceiver(topicName, subscriptionName, {
                receiveMode: 'peekLock',
                subQueueType: 'deadLetter'
            });
        } else {
            throw new Error('Either queueName or both topicName and subscriptionName must be provided');
        }

        try {
            const messages = await receiver.receiveMessages(maxMessages, { maxWaitTimeInMs: 5000 });
            return messages;
        } finally {
            await receiver.close();
        }
    }

    /**
     * Build the DLQ path for REST API calls
     */
    private getDlqPath(queueName?: string, topicName?: string, subscriptionName?: string): string {
        if (queueName) {
            return `${queueName}/$deadletterqueue`;
        } else if (topicName && subscriptionName) {
            return `${topicName}/Subscriptions/${subscriptionName}/$deadletterqueue`;
        }
        throw new Error('Either queueName or both topicName and subscriptionName must be provided');
    }

    /**
     * Generate SAS token from connection string for REST API calls
     */
    private generateSasToken(resourceUri: string, connectionString: string, validityInSeconds: number = 3600): string {
        // Parse connection string
        const parts = connectionString.split(';').reduce((acc, part) => {
            const [key, ...valueParts] = part.split('=');
            if (key && valueParts.length > 0) {
                acc[key.trim()] = valueParts.join('=').trim();
            }
            return acc;
        }, {} as Record<string, string>);

        const sharedAccessKeyName = parts['SharedAccessKeyName'];
        const sharedAccessKey = parts['SharedAccessKey'];

        if (!sharedAccessKeyName || !sharedAccessKey) {
            throw new Error('Connection string must contain SharedAccessKeyName and SharedAccessKey');
        }

        const encodedUri = encodeURIComponent(resourceUri);
        const expiry = Math.floor(Date.now() / 1000) + validityInSeconds;
        const stringToSign = `${encodedUri}\n${expiry}`;

        // Create HMAC-SHA256 signature
        const crypto = require('crypto');
        const signature = crypto.createHmac('sha256', sharedAccessKey)
            .update(stringToSign)
            .digest('base64');

        const encodedSignature = encodeURIComponent(signature);

        return `SharedAccessSignature sr=${encodedUri}&sig=${encodedSignature}&se=${expiry}&skn=${sharedAccessKeyName}`;
    }

    /**
     * Get auth header for REST API calls (supports both connection string and Azure AD)
     */
    private async getAuthHeader(namespace: string): Promise<string> {
        const connectionString = this.connectionStrings.get(namespace);

        if (connectionString) {
            // Use SAS token from connection string
            const resourceUri = `https://${namespace}`;
            const sasToken = this.generateSasToken(resourceUri, connectionString);
            return sasToken;
        } else {
            // Use Azure AD bearer token
            const token = await this.credential.getToken('https://servicebus.azure.net/.default');
            if (!token) {
                throw new Error('Failed to get authentication token');
            }
            return `Bearer ${token.token}`;
        }
    }

    /**
     * Peek-lock a message from DLQ using REST API (works with session-enabled entities)
     */
    private async peekLockMessageRest(
        namespace: string,
        dlqPath: string
    ): Promise<{ body: unknown; brokerProperties: Record<string, unknown>; userProperties: Record<string, unknown>; location: string } | null> {
        const authHeader = await this.getAuthHeader(namespace);
        const url = `https://${namespace}/${dlqPath}/messages/head`;

        console.log(`[ServiceBus REST] Peek-lock from: ${url}`);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 204) {
            // No messages available
            return null;
        }

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`REST API peek-lock failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const brokerPropertiesHeader = response.headers.get('BrokerProperties');
        const brokerProperties = brokerPropertiesHeader ? JSON.parse(brokerPropertiesHeader) : {};
        const location = response.headers.get('Location') || '';

        // Parse user/application properties from headers
        const userProperties: Record<string, unknown> = {};
        response.headers.forEach((value, key) => {
            // User properties come as custom headers (not standard ones)
            if (!['brokerproperties', 'location', 'content-type', 'date', 'server', 'transfer-encoding', 'strict-transport-security'].includes(key.toLowerCase())) {
                try {
                    userProperties[key] = JSON.parse(value);
                } catch {
                    userProperties[key] = value;
                }
            }
        });

        // Get body as raw text to preserve original format
        // Don't parse JSON - we want to send it back exactly as received
        const body = await response.text();

        console.log(`[ServiceBus REST] Peek-lock successful, SequenceNumber: ${brokerProperties.SequenceNumber}, LockToken: ${brokerProperties.LockToken}`);

        return { body, brokerProperties, userProperties, location };
    }

    /**
     * Delete (complete) a message using REST API
     */
    private async deleteMessageRest(namespace: string, location: string): Promise<void> {
        const authHeader = await this.getAuthHeader(namespace);

        console.log(`[ServiceBus REST] Deleting message at: ${location}`);

        const response = await fetch(location, {
            method: 'DELETE',
            headers: {
                'Authorization': authHeader
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`REST API delete failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        console.log(`[ServiceBus REST] Message deleted successfully`);
    }

    /**
     * Unlock (abandon) a message using REST API
     */
    private async unlockMessageRest(namespace: string, location: string): Promise<void> {
        const authHeader = await this.getAuthHeader(namespace);

        console.log(`[ServiceBus REST] Unlocking message at: ${location}`);

        const response = await fetch(location, {
            method: 'PUT',
            headers: {
                'Authorization': authHeader
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`REST API unlock failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        console.log(`[ServiceBus REST] Message unlocked successfully`);
    }

    async resubmitMessage(
        namespace: string,
        message: ServiceBusReceivedMessage,
        queueName?: string,
        topicName?: string,
        subscriptionName?: string
    ): Promise<void> {
        const client = this.getClient(namespace);

        // Create sender to the original queue or topic
        let sender: ServiceBusSender;
        if (queueName) {
            sender = client.createSender(queueName);
        } else if (topicName) {
            sender = client.createSender(topicName);
        } else {
            throw new Error('Either queueName or topicName must be provided');
        }

        // Create receiver for the dead-letter queue
        let receiver;
        if (queueName) {
            receiver = client.createReceiver(queueName, {
                receiveMode: 'peekLock',
                subQueueType: 'deadLetter'
            });
        } else if (topicName && subscriptionName) {
            receiver = client.createReceiver(topicName, subscriptionName, {
                receiveMode: 'peekLock',
                subQueueType: 'deadLetter'
            });
        } else {
            throw new Error('Either queueName or both topicName and subscriptionName must be provided');
        }

        try {
            let targetMessage: ServiceBusReceivedMessage | undefined;
            const maxMessages = 1000;
            let processedCount = 0;
            const targetSequenceNumber = message.sequenceNumber?.toString();

            console.log(`[ServiceBus] Looking for message with sequenceNumber: ${targetSequenceNumber}`);

            // First, peek to verify messages exist and check if target is there
            // Use fromSequenceNumber: 1 to peek from the beginning (important!)
            const peekedMessages = await receiver.peekMessages(100, { fromSequenceNumber: Long.fromInt(1) });
            console.log(`[ServiceBus] Peeked ${peekedMessages.length} messages in DLQ`);

            if (peekedMessages.length === 0) {
                throw new Error('No messages found in dead-letter queue.');
            }

            const peekedTarget = peekedMessages.find(m => m.sequenceNumber?.toString() === targetSequenceNumber);
            if (!peekedTarget) {
                console.log(`[ServiceBus] Target message not found in first ${peekedMessages.length} peeked messages`);
                throw new Error('Target message not found in dead-letter queue.');
            }
            console.log(`[ServiceBus] Target message found in peeked messages`);

            // Try to receive messages with peekLock first
            console.log(`[ServiceBus] Attempting to receive messages with peekLock mode...`);
            const messages = await receiver.receiveMessages(100, { maxWaitTimeInMs: 10000 });
            console.log(`[ServiceBus] Received ${messages.length} messages with peekLock`);

            if (messages.length > 0) {
                // peekLock worked, find and process the target message
                for (const msg of messages) {
                    const msgSeqNum = msg.sequenceNumber?.toString();
                    if (msgSeqNum === targetSequenceNumber) {
                        console.log(`[ServiceBus] Found target message with peekLock!`);
                        targetMessage = msg;
                    } else {
                        // Abandon non-target messages
                        await receiver.abandonMessage(msg);
                    }
                }
            }

            // If peekLock didn't work (returns 0 messages), use the peeked data directly
            // This can happen with session-enabled subscriptions even if "requires session" is false
            if (!targetMessage) {
                console.log(`[ServiceBus] peekLock receive returned 0 messages, using peeked message data directly`);

                // Send the message using the peeked data
                let messageBody = peekedTarget.body;
                if (messageBody !== null && messageBody !== undefined) {
                    if (typeof messageBody === 'object' && !Buffer.isBuffer(messageBody)) {
                        try {
                            messageBody = convertToPlainObject(messageBody);
                            console.log(`[ServiceBus] Converted message body to JSON`);
                        } catch (e) {
                            console.log(`[ServiceBus] Could not convert body to JSON, using as-is: ${e}`);
                        }
                    }
                }

                // Convert applicationProperties to plain object (may contain AMQP types like AmqpMap)
                const convertedAppProps = convertToPlainObject(peekedTarget.applicationProperties) as Record<string, unknown> | undefined;

                console.log(`[ServiceBus] Sending message to main queue/topic`);
                await sender.sendMessages({
                    body: messageBody,
                    contentType: peekedTarget.contentType,
                    correlationId: peekedTarget.correlationId,
                    subject: peekedTarget.subject,
                    sessionId: peekedTarget.sessionId,
                    messageId: `resubmit-${peekedTarget.messageId}`,
                    applicationProperties: {
                        ...convertedAppProps,
                        'x-resubmitted': true,
                        'x-original-dead-letter-reason': peekedTarget.deadLetterReason,
                        'x-original-message-id': peekedTarget.messageId
                    }
                });
                console.log(`[ServiceBus] Message sent to main queue/topic`);

                // Now try to delete the message from DLQ using receiveAndDelete mode
                await receiver.close();

                let deleteReceiver;
                if (queueName) {
                    deleteReceiver = client.createReceiver(queueName, {
                        receiveMode: 'receiveAndDelete',
                        subQueueType: 'deadLetter'
                    });
                } else {
                    deleteReceiver = client.createReceiver(topicName!, subscriptionName!, {
                        receiveMode: 'receiveAndDelete',
                        subQueueType: 'deadLetter'
                    });
                }

                try {
                    console.log(`[ServiceBus] Attempting to delete message from DLQ using receiveAndDelete...`);
                    const deletedMessages = await deleteReceiver.receiveMessages(100, { maxWaitTimeInMs: 10000 });
                    console.log(`[ServiceBus] receiveAndDelete got ${deletedMessages.length} messages`);

                    // Match by messageId since sequence number may differ
                    const targetMessageId = peekedTarget.messageId;
                    const wasDeleted = deletedMessages.some(m =>
                        m.messageId === targetMessageId ||
                        m.sequenceNumber?.toString() === targetSequenceNumber
                    );

                    if (wasDeleted) {
                        console.log(`[ServiceBus] Target message was deleted from DLQ`);
                    } else if (deletedMessages.length > 0) {
                        // Log what we deleted for debugging
                        console.log(`[ServiceBus] Deleted messages had IDs: ${deletedMessages.map(m => m.messageId).join(', ')}`);
                        console.log(`[ServiceBus] Target messageId was: ${targetMessageId}, sequenceNumber: ${targetSequenceNumber}`);
                        console.log(`[ServiceBus] WARNING: Deleted ${deletedMessages.length} message(s) - assuming target was among them`);
                    } else {
                        console.log(`[ServiceBus] WARNING: Could not delete message from DLQ (receiveAndDelete returned 0 messages)`);
                        console.log(`[ServiceBus] Message was resubmitted but may still exist in DLQ - please delete manually`);
                    }
                } finally {
                    await deleteReceiver.close();
                }

                return; // We've handled everything in this branch
            }

            // Send the message back to the main queue/topic
            // The body may contain AMQP-specific types (like AmqpMap) that can't be re-serialized.
            // Convert to JSON string to ensure it can be sent.
            let messageBody = targetMessage.body;
            let contentType = targetMessage.contentType;

            if (messageBody !== null && messageBody !== undefined) {
                // If body is an object with AMQP types, serialize to JSON
                if (typeof messageBody === 'object' && !Buffer.isBuffer(messageBody)) {
                    try {
                        // Deep clone and convert to plain JSON to strip AMQP types
                        messageBody = convertToPlainObject(messageBody);
                        console.log(`[ServiceBus] Converted message body to JSON`);
                    } catch (e) {
                        console.log(`[ServiceBus] Could not convert body to JSON, using as-is: ${e}`);
                    }
                }
            }

            // Convert applicationProperties to plain object (may contain AMQP types like AmqpMap)
            const convertedAppProps = convertToPlainObject(targetMessage.applicationProperties) as Record<string, unknown> | undefined;

            console.log(`[ServiceBus] Sending message to main queue/topic`);
            await sender.sendMessages({
                body: messageBody,
                contentType: contentType,
                correlationId: targetMessage.correlationId,
                subject: targetMessage.subject,
                sessionId: targetMessage.sessionId,
                messageId: targetMessage.messageId,
                applicationProperties: {
                    ...convertedAppProps,
                    'x-resubmitted': true,
                    'x-original-dead-letter-reason': targetMessage.deadLetterReason
                }
            });

            // Complete (delete) the message from DLQ
            console.log(`[ServiceBus] Completing message in DLQ`);
            await receiver.completeMessage(targetMessage);
            console.log(`[ServiceBus] Resubmit completed successfully`);
        } finally {
            await sender.close();
            await receiver.close();
        }
    }

    async deleteMessage(
        namespace: string,
        message: ServiceBusReceivedMessage,
        queueName?: string,
        topicName?: string,
        subscriptionName?: string
    ): Promise<void> {
        const client = this.getClient(namespace);

        let receiver;
        if (queueName) {
            receiver = client.createReceiver(queueName, {
                receiveMode: 'peekLock',
                subQueueType: 'deadLetter'
            });
        } else if (topicName && subscriptionName) {
            receiver = client.createReceiver(topicName, subscriptionName, {
                receiveMode: 'peekLock',
                subQueueType: 'deadLetter'
            });
        } else {
            throw new Error('Either queueName or both topicName and subscriptionName must be provided');
        }

        try {
            let targetMessage: ServiceBusReceivedMessage | undefined;
            const maxMessages = 1000;
            let processedCount = 0;
            const targetSequenceNumber = message.sequenceNumber?.toString();

            console.log(`[ServiceBus] Looking for message to delete with sequenceNumber: ${targetSequenceNumber}`);

            while (processedCount < maxMessages) {
                console.log(`[ServiceBus] Receiving messages from DLQ (attempt ${processedCount + 1})`);
                const messages = await receiver.receiveMessages(1, { maxWaitTimeInMs: 5000 });

                console.log(`[ServiceBus] Received ${messages.length} messages`);

                if (messages.length === 0) {
                    break;
                }

                const msg = messages[0];
                processedCount++;
                const msgSeqNum = msg.sequenceNumber?.toString();

                console.log(`[ServiceBus] Checking message with sequenceNumber: ${msgSeqNum}`);

                if (msgSeqNum === targetSequenceNumber) {
                    console.log(`[ServiceBus] Found target message!`);
                    targetMessage = msg;
                    break;
                } else {
                    console.log(`[ServiceBus] Not a match, abandoning message`);
                    await receiver.abandonMessage(msg);
                }
            }

            if (!targetMessage) {
                throw new Error('Message not found in dead-letter queue. It may have already been deleted.');
            }

            console.log(`[ServiceBus] Completing (deleting) message from DLQ`);
            await receiver.completeMessage(targetMessage);
            console.log(`[ServiceBus] Delete completed successfully`);
        } finally {
            await receiver.close();
        }
    }

    async purgeDeadLetterQueue(
        namespace: string,
        queueName?: string,
        topicName?: string,
        subscriptionName?: string
    ): Promise<number> {
        const client = this.getClient(namespace);
        let receiver;

        if (queueName) {
            receiver = client.createReceiver(queueName, {
                receiveMode: 'peekLock',
                subQueueType: 'deadLetter'
            });
        } else if (topicName && subscriptionName) {
            receiver = client.createReceiver(topicName, subscriptionName, {
                receiveMode: 'peekLock',
                subQueueType: 'deadLetter'
            });
        } else {
            throw new Error('Either queueName or both topicName and subscriptionName must be provided');
        }

        try {
            let totalDeleted = 0;
            let messages: ServiceBusReceivedMessage[];

            do {
                messages = await receiver.receiveMessages(100, { maxWaitTimeInMs: 5000 });
                for (const message of messages) {
                    await receiver.completeMessage(message);
                    totalDeleted++;
                }
            } while (messages.length > 0);

            return totalDeleted;
        } finally {
            await receiver.close();
        }
    }

    async dispose(): Promise<void> {
        for (const client of this.clients.values()) {
            await client.close();
        }
        this.clients.clear();
        this.adminClients.clear();
    }
}

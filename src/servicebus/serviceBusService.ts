import {
    ServiceBusClient,
    ServiceBusAdministrationClient,
    ServiceBusReceivedMessage,
    ServiceBusSender
} from '@azure/service-bus';
import { TokenCredential } from '@azure/identity';
import { getAzureCredential } from './authProvider';

export interface QueueInfo {
    name: string;
    activeMessageCount: number;
    deadLetterMessageCount: number;
}

export interface TopicInfo {
    name: string;
    subscriptionCount?: number;
}

export interface SubscriptionInfo {
    name: string;
    topicName: string;
    activeMessageCount: number;
    deadLetterMessageCount: number;
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
            topics.push({
                name: topic.name,
                subscriptionCount: runtimeProps.subscriptionCount
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

            const messages = await Promise.race([
                receiver.peekMessages(maxMessages),
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
            // Add timeout wrapper to prevent hanging
            const timeoutPromise = new Promise<ServiceBusReceivedMessage[]>((_, reject) => {
                setTimeout(() => reject(new Error('Peek operation timed out after 30 seconds')), 30000);
            });

            const messages = await Promise.race([
                receiver.peekMessages(maxMessages),
                timeoutPromise
            ]);
            return messages;
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
            // Receive the specific message by sequence number
            const messages = await receiver.receiveMessages(100, { maxWaitTimeInMs: 5000 });
            const targetMessage = messages.find(
                m => m.sequenceNumber === message.sequenceNumber
            );

            if (!targetMessage) {
                throw new Error('Message not found in dead-letter queue');
            }

            // Send the message back to the main queue/topic
            await sender.sendMessages({
                body: targetMessage.body,
                contentType: targetMessage.contentType,
                correlationId: targetMessage.correlationId,
                subject: targetMessage.subject,
                messageId: `resubmit-${targetMessage.messageId}`,
                applicationProperties: {
                    ...targetMessage.applicationProperties,
                    'x-resubmitted': true,
                    'x-original-dead-letter-reason': targetMessage.deadLetterReason,
                    'x-original-message-id': targetMessage.messageId
                }
            });

            // Complete the dead-letter message
            await receiver.completeMessage(targetMessage);
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
            // Receive the specific message
            const messages = await receiver.receiveMessages(100, { maxWaitTimeInMs: 5000 });
            const targetMessage = messages.find(
                m => m.sequenceNumber === message.sequenceNumber
            );

            if (!targetMessage) {
                throw new Error('Message not found in dead-letter queue');
            }

            // Complete (delete) the message
            await receiver.completeMessage(targetMessage);
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

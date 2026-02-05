import * as vscode from 'vscode';
import { ServiceBusService } from '../servicebus/serviceBusService';
import {
    ServiceBusTreeItem,
    NamespaceTreeItem,
    QueuesFolderTreeItem,
    TopicsFolderTreeItem,
    QueueTreeItem,
    TopicTreeItem,
    SubscriptionTreeItem,
    ActiveMessagesTreeItem,
    DeadLetterQueueTreeItem,
    MessageTreeItem,
    AddNamespaceTreeItem,
    MessageInfo
} from './treeItems';

export class ServiceBusTreeProvider implements vscode.TreeDataProvider<ServiceBusTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ServiceBusTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private namespaces: Set<string> = new Set();
    private serviceBusService: ServiceBusService;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext, serviceBusService: ServiceBusService) {
        this.context = context;
        this.serviceBusService = serviceBusService;
        this.loadNamespaces();
    }

    private loadNamespaces(): void {
        const savedNamespaces = this.context.globalState.get<string[]>('azureServiceBus.namespaces', []);
        this.namespaces = new Set(savedNamespaces);
    }

    private saveNamespaces(): void {
        this.context.globalState.update('azureServiceBus.namespaces', Array.from(this.namespaces));
    }

    addNamespace(namespace: string): void {
        const normalizedNamespace = namespace.includes('.servicebus.windows.net')
            ? namespace
            : `${namespace}.servicebus.windows.net`;
        this.namespaces.add(normalizedNamespace);
        this.saveNamespaces();
        this.refresh();
    }

    removeNamespace(namespace: string): void {
        this.namespaces.delete(namespace);
        this.saveNamespaces();
        this.refresh();
    }

    refresh(element?: ServiceBusTreeItem): void {
        this._onDidChangeTreeData.fire(element);
    }

    getTreeItem(element: ServiceBusTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ServiceBusTreeItem): Promise<ServiceBusTreeItem[]> {
        if (!element) {
            // Root level - show namespaces
            const items: ServiceBusTreeItem[] = Array.from(this.namespaces).map(
                ns => new NamespaceTreeItem(ns)
            );
            items.push(new AddNamespaceTreeItem());
            return items;
        }

        try {
            switch (element.itemType) {
                case 'namespace':
                    return this.getNamespaceChildren(element as NamespaceTreeItem);
                case 'queuesFolder':
                    return this.getQueuesFolderChildren(element as QueuesFolderTreeItem);
                case 'topicsFolder':
                    return this.getTopicsFolderChildren(element as TopicsFolderTreeItem);
                case 'queue':
                    return this.getQueueChildren(element as QueueTreeItem);
                case 'topic':
                    return this.getTopicChildren(element as TopicTreeItem);
                case 'subscription':
                    return this.getSubscriptionChildren(element as SubscriptionTreeItem);
                case 'activeMessages':
                    return this.getActiveMessagesChildren(element as ActiveMessagesTreeItem);
                case 'deadLetterQueue':
                    return this.getDeadLetterQueueChildren(element as DeadLetterQueueTreeItem);
                default:
                    return [];
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to load Service Bus data: ${errorMessage}`);
            return [];
        }
    }

    private async getNamespaceChildren(element: NamespaceTreeItem): Promise<ServiceBusTreeItem[]> {
        return [
            new QueuesFolderTreeItem(element.namespace),
            new TopicsFolderTreeItem(element.namespace)
        ];
    }

    private async getQueuesFolderChildren(element: QueuesFolderTreeItem): Promise<ServiceBusTreeItem[]> {
        const queues = await this.serviceBusService.listQueues(element.namespace);
        return queues.map(queue => new QueueTreeItem(
            element.namespace,
            queue.name,
            queue.activeMessageCount,
            queue.deadLetterMessageCount
        ));
    }

    private async getTopicsFolderChildren(element: TopicsFolderTreeItem): Promise<ServiceBusTreeItem[]> {
        const topics = await this.serviceBusService.listTopics(element.namespace);
        return topics.map(topic => new TopicTreeItem(
            element.namespace,
            topic.name,
            topic.subscriptionCount
        ));
    }

    private async getQueueChildren(element: QueueTreeItem): Promise<ServiceBusTreeItem[]> {
        return [
            new ActiveMessagesTreeItem(
                element.namespace,
                element.queueName,
                undefined,
                undefined,
                element.activeMessageCount
            ),
            new DeadLetterQueueTreeItem(
                element.namespace,
                element.queueName,
                undefined,
                undefined,
                element.deadLetterMessageCount
            )
        ];
    }

    private async getTopicChildren(element: TopicTreeItem): Promise<ServiceBusTreeItem[]> {
        const subscriptions = await this.serviceBusService.listSubscriptions(
            element.namespace,
            element.topicName
        );
        return subscriptions.map(sub => new SubscriptionTreeItem(
            element.namespace,
            element.topicName,
            sub.name,
            sub.activeMessageCount,
            sub.deadLetterMessageCount
        ));
    }

    private async getSubscriptionChildren(element: SubscriptionTreeItem): Promise<ServiceBusTreeItem[]> {
        return [
            new ActiveMessagesTreeItem(
                element.namespace,
                undefined,
                element.topicName,
                element.subscriptionName,
                element.activeMessageCount
            ),
            new DeadLetterQueueTreeItem(
                element.namespace,
                undefined,
                element.topicName,
                element.subscriptionName,
                element.deadLetterMessageCount
            )
        ];
    }

    private async getActiveMessagesChildren(element: ActiveMessagesTreeItem): Promise<ServiceBusTreeItem[]> {
        const messages = await this.serviceBusService.peekActiveMessages(
            element.namespace,
            element.queueName,
            element.topicName,
            element.subscriptionName
        );

        return messages.map(message => {
            const messageInfo: MessageInfo = {
                namespace: element.namespace,
                message,
                queueName: element.queueName,
                topicName: element.topicName,
                subscriptionName: element.subscriptionName,
                isDeadLetter: false
            };
            return new MessageTreeItem(messageInfo);
        });
    }

    private async getDeadLetterQueueChildren(element: DeadLetterQueueTreeItem): Promise<ServiceBusTreeItem[]> {
        try {
            console.log(`[ServiceBus] Peeking dead-letter messages from ${element.queueName || `${element.topicName}/${element.subscriptionName}`}`);

            const messages = await this.serviceBusService.peekDeadLetterMessages(
                element.namespace,
                element.queueName,
                element.topicName,
                element.subscriptionName
            );

            console.log(`[ServiceBus] Found ${messages.length} dead-letter messages`);

            return messages.map(message => {
                const messageInfo: MessageInfo = {
                    namespace: element.namespace,
                    message,
                    queueName: element.queueName,
                    topicName: element.topicName,
                    subscriptionName: element.subscriptionName,
                    isDeadLetter: true
                };
                return new MessageTreeItem(messageInfo);
            });
        } catch (error) {
            console.error(`[ServiceBus] Error peeking dead-letter messages:`, error);
            throw error;
        }
    }
}

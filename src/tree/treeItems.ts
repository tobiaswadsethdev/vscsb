import * as vscode from 'vscode';
import { ServiceBusReceivedMessage } from '@azure/service-bus';

export type TreeItemType =
    | 'namespace'
    | 'namespaceSummary'
    | 'queuesFolder'
    | 'topicsFolder'
    | 'queue'
    | 'topic'
    | 'subscription'
    | 'activeMessages'
    | 'deadLetterQueue'
    | 'activeMessage'
    | 'deadLetterMessage'
    | 'addNamespace';

export interface MessageInfo {
    namespace: string;
    message: ServiceBusReceivedMessage;
    queueName?: string;
    topicName?: string;
    subscriptionName?: string;
    isDeadLetter: boolean;
}

export abstract class ServiceBusTreeItem extends vscode.TreeItem {
    abstract readonly itemType: TreeItemType;

    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
    }
}

export class NamespaceTreeItem extends ServiceBusTreeItem {
    readonly itemType = 'namespace' as const;

    constructor(
        public readonly namespace: string
    ) {
        super(namespace, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'namespace';
        this.iconPath = new vscode.ThemeIcon('cloud');
        this.tooltip = `Azure Service Bus Namespace: ${namespace}`;
    }
}

export class NamespaceSummaryTreeItem extends ServiceBusTreeItem {
    readonly itemType = 'namespaceSummary' as const;

    constructor(
        public readonly namespace: string,
        public readonly totalActiveMessages: number,
        public readonly totalDeadLetterMessages: number
    ) {
        super(`[${totalActiveMessages}|${totalDeadLetterMessages}] Total Messages`, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'namespaceSummary';
        this.iconPath = new vscode.ThemeIcon('pulse');
        this.tooltip = `Total Active Messages: ${totalActiveMessages}\nTotal Dead Letter Messages: ${totalDeadLetterMessages}`;
    }
}

export class QueuesFolderTreeItem extends ServiceBusTreeItem {
    readonly itemType = 'queuesFolder' as const;

    constructor(
        public readonly namespace: string
    ) {
        super('Queues', vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'queuesFolder';
        this.iconPath = new vscode.ThemeIcon('inbox');
        this.tooltip = 'Queues';
    }
}

export class TopicsFolderTreeItem extends ServiceBusTreeItem {
    readonly itemType = 'topicsFolder' as const;

    constructor(
        public readonly namespace: string
    ) {
        super('Topics', vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'topicsFolder';
        this.iconPath = new vscode.ThemeIcon('broadcast');
        this.tooltip = 'Topics';
    }
}

export class QueueTreeItem extends ServiceBusTreeItem {
    readonly itemType = 'queue' as const;

    constructor(
        public readonly namespace: string,
        public readonly queueName: string,
        public readonly activeMessageCount: number,
        public readonly deadLetterMessageCount: number
    ) {
        super(`[${activeMessageCount}|${deadLetterMessageCount}] ${queueName}`, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'queue';
        this.iconPath = new vscode.ThemeIcon('mail');
        this.tooltip = `Queue: ${queueName}\nActive Messages: ${activeMessageCount}\nDead Letter Messages: ${deadLetterMessageCount}`;
    }
}

export class TopicTreeItem extends ServiceBusTreeItem {
    readonly itemType = 'topic' as const;

    constructor(
        public readonly namespace: string,
        public readonly topicName: string,
        public readonly subscriptionCount?: number,
        public readonly activeMessageCount?: number,
        public readonly deadLetterMessageCount?: number
    ) {
        const messageCountDisplay = (activeMessageCount !== undefined && deadLetterMessageCount !== undefined)
            ? `[${activeMessageCount}|${deadLetterMessageCount}] `
            : '';
        super(`${messageCountDisplay}${topicName}`, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'topic';
        this.iconPath = new vscode.ThemeIcon('broadcast');
        this.description = `${subscriptionCount ?? 0} subscriptions`;
        this.tooltip = `Topic: ${topicName}\nSubscriptions: ${subscriptionCount}\nActive Messages: ${activeMessageCount ?? 0}\nDead Letter Messages: ${deadLetterMessageCount ?? 0}`;
    }
}

export class SubscriptionTreeItem extends ServiceBusTreeItem {
    readonly itemType = 'subscription' as const;

    constructor(
        public readonly namespace: string,
        public readonly topicName: string,
        public readonly subscriptionName: string,
        public readonly activeMessageCount: number,
        public readonly deadLetterMessageCount: number
    ) {
        super(`[${activeMessageCount}|${deadLetterMessageCount}] ${subscriptionName}`, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'subscription';
        this.iconPath = new vscode.ThemeIcon('list-tree');
        this.tooltip = `Subscription: ${subscriptionName}\nActive Messages: ${activeMessageCount}\nDead Letter Messages: ${deadLetterMessageCount}`;
    }
}

export class ActiveMessagesTreeItem extends ServiceBusTreeItem {
    readonly itemType = 'activeMessages' as const;

    constructor(
        public readonly namespace: string,
        public readonly queueName: string | undefined,
        public readonly topicName: string | undefined,
        public readonly subscriptionName: string | undefined,
        public readonly messageCount: number
    ) {
        super(`[${messageCount}] Active Messages`, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'activeMessages';
        this.iconPath = new vscode.ThemeIcon('mail-read');
        this.tooltip = `Active Messages: ${messageCount}`;
    }
}

export class DeadLetterQueueTreeItem extends ServiceBusTreeItem {
    readonly itemType = 'deadLetterQueue' as const;

    constructor(
        public readonly namespace: string,
        public readonly queueName: string | undefined,
        public readonly topicName: string | undefined,
        public readonly subscriptionName: string | undefined,
        public readonly messageCount: number
    ) {
        super(`[${messageCount}] Dead Letter Queue`, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'deadLetterQueue';
        this.iconPath = new vscode.ThemeIcon('warning');
        this.tooltip = `Dead Letter Messages: ${messageCount}`;
    }
}

export class MessageTreeItem extends ServiceBusTreeItem {
    readonly itemType: 'activeMessage' | 'deadLetterMessage';

    constructor(
        public readonly messageInfo: MessageInfo
    ) {
        const messageId = messageInfo.message.messageId?.toString() || 'Unknown';
        const label = `Message: ${messageId.substring(0, 20)}${messageId.length > 20 ? '...' : ''}`;
        super(label, vscode.TreeItemCollapsibleState.None);

        this.itemType = messageInfo.isDeadLetter ? 'deadLetterMessage' : 'activeMessage';
        this.contextValue = this.itemType;
        this.iconPath = messageInfo.isDeadLetter
            ? new vscode.ThemeIcon('error')
            : new vscode.ThemeIcon('mail');

        const enqueuedTime = messageInfo.message.enqueuedTimeUtc?.toISOString() || 'Unknown';
        this.description = enqueuedTime;

        let tooltip = `Message ID: ${messageId}\nEnqueued: ${enqueuedTime}`;
        if (messageInfo.isDeadLetter) {
            tooltip += `\nDead Letter Reason: ${messageInfo.message.deadLetterReason || 'Unknown'}`;
            tooltip += `\nError Description: ${messageInfo.message.deadLetterErrorDescription || 'N/A'}`;
        }
        this.tooltip = tooltip;

        // Command to view message when clicked
        this.command = {
            command: 'azureServiceBus.viewMessage',
            title: 'View Message',
            arguments: [this]
        };
    }
}

export class AddNamespaceTreeItem extends ServiceBusTreeItem {
    readonly itemType = 'addNamespace' as const;

    constructor() {
        super('Add Namespace...', vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'addNamespace';
        this.iconPath = new vscode.ThemeIcon('add');
        this.tooltip = 'Add a new Service Bus namespace';
        this.command = {
            command: 'azureServiceBus.addNamespace',
            title: 'Add Namespace'
        };
    }
}

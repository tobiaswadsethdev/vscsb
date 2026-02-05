import * as vscode from 'vscode';
import { ServiceBusService } from '../servicebus/serviceBusService';
import { ServiceBusTreeProvider } from '../tree/serviceBusTreeProvider';
import { MessagePanel } from '../views/messagePanel';
import {
    MessageTreeItem,
    DeadLetterQueueTreeItem,
    QueueTreeItem,
    SubscriptionTreeItem,
    ActiveMessagesTreeItem
} from '../tree/treeItems';

export function registerMessageCommands(
    context: vscode.ExtensionContext,
    treeProvider: ServiceBusTreeProvider,
    serviceBusService: ServiceBusService
): void {
    // View Message Command
    const viewMessageCommand = vscode.commands.registerCommand(
        'azureServiceBus.viewMessage',
        async (item?: MessageTreeItem) => {
            if (!item) {
                vscode.window.showWarningMessage('Please select a message to view');
                return;
            }

            MessagePanel.createOrShow(context.extensionUri, item.messageInfo);
        }
    );

    // Peek Messages Command
    const peekMessagesCommand = vscode.commands.registerCommand(
        'azureServiceBus.peekMessages',
        async (item?: QueueTreeItem | SubscriptionTreeItem | ActiveMessagesTreeItem | DeadLetterQueueTreeItem) => {
            if (!item) {
                vscode.window.showWarningMessage('Please select a queue, subscription, or message folder to peek');
                return;
            }

            try {
                let namespace: string;
                let queueName: string | undefined;
                let topicName: string | undefined;
                let subscriptionName: string | undefined;
                let isDeadLetter = false;

                switch (item.itemType) {
                    case 'queue':
                        namespace = (item as QueueTreeItem).namespace;
                        queueName = (item as QueueTreeItem).queueName;
                        break;
                    case 'subscription':
                        namespace = (item as SubscriptionTreeItem).namespace;
                        topicName = (item as SubscriptionTreeItem).topicName;
                        subscriptionName = (item as SubscriptionTreeItem).subscriptionName;
                        break;
                    case 'activeMessages':
                        namespace = (item as ActiveMessagesTreeItem).namespace;
                        queueName = (item as ActiveMessagesTreeItem).queueName;
                        topicName = (item as ActiveMessagesTreeItem).topicName;
                        subscriptionName = (item as ActiveMessagesTreeItem).subscriptionName;
                        break;
                    case 'deadLetterQueue':
                        namespace = (item as DeadLetterQueueTreeItem).namespace;
                        queueName = (item as DeadLetterQueueTreeItem).queueName;
                        topicName = (item as DeadLetterQueueTreeItem).topicName;
                        subscriptionName = (item as DeadLetterQueueTreeItem).subscriptionName;
                        isDeadLetter = true;
                        break;
                    default:
                        return;
                }

                const countInput = await vscode.window.showInputBox({
                    prompt: 'How many messages to peek?',
                    value: '10',
                    validateInput: (value) => {
                        const num = parseInt(value, 10);
                        if (isNaN(num) || num < 1 || num > 100) {
                            return 'Please enter a number between 1 and 100';
                        }
                        return null;
                    }
                });

                if (!countInput) {
                    return;
                }

                const count = parseInt(countInput, 10);

                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `Peeking ${count} messages...`,
                        cancellable: false
                    },
                    async () => {
                        const messages = isDeadLetter
                            ? await serviceBusService.peekDeadLetterMessages(
                                namespace,
                                queueName,
                                topicName,
                                subscriptionName,
                                count
                            )
                            : await serviceBusService.peekActiveMessages(
                                namespace,
                                queueName,
                                topicName,
                                subscriptionName,
                                count
                            );

                        vscode.window.showInformationMessage(
                            `Peeked ${messages.length} messages. Refresh the tree to see them.`
                        );
                        treeProvider.refresh(item);
                    }
                );
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to peek messages: ${errorMessage}`);
            }
        }
    );

    // Resubmit Message Command
    const resubmitMessageCommand = vscode.commands.registerCommand(
        'azureServiceBus.resubmitMessage',
        async (item?: MessageTreeItem) => {
            if (!item || !item.messageInfo.isDeadLetter) {
                vscode.window.showWarningMessage('Please select a dead-letter message to resubmit');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                'Are you sure you want to resubmit this message to the main queue?',
                { modal: true },
                'Resubmit'
            );

            if (confirm !== 'Resubmit') {
                return;
            }

            try {
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Resubmitting message...',
                        cancellable: false
                    },
                    async () => {
                        const { namespace, message, queueName, topicName, subscriptionName } = item.messageInfo;

                        await serviceBusService.resubmitMessage(
                            namespace,
                            message,
                            queueName,
                            topicName,
                            subscriptionName
                        );

                        vscode.window.showInformationMessage('Message resubmitted successfully');
                        treeProvider.refresh();
                    }
                );
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to resubmit message: ${errorMessage}`);
            }
        }
    );

    // Delete Message Command
    const deleteMessageCommand = vscode.commands.registerCommand(
        'azureServiceBus.deleteMessage',
        async (item?: MessageTreeItem) => {
            if (!item || !item.messageInfo.isDeadLetter) {
                vscode.window.showWarningMessage('Please select a dead-letter message to delete');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                'Are you sure you want to permanently delete this message?',
                { modal: true },
                'Delete'
            );

            if (confirm !== 'Delete') {
                return;
            }

            try {
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Deleting message...',
                        cancellable: false
                    },
                    async () => {
                        const { namespace, message, queueName, topicName, subscriptionName } = item.messageInfo;

                        await serviceBusService.deleteMessage(
                            namespace,
                            message,
                            queueName,
                            topicName,
                            subscriptionName
                        );

                        vscode.window.showInformationMessage('Message deleted successfully');
                        treeProvider.refresh();
                    }
                );
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to delete message: ${errorMessage}`);
            }
        }
    );

    // Purge Dead Letter Queue Command
    const purgeDeadLetterCommand = vscode.commands.registerCommand(
        'azureServiceBus.purgeDeadLetter',
        async (item?: DeadLetterQueueTreeItem) => {
            if (!item) {
                vscode.window.showWarningMessage('Please select a dead-letter queue to purge');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Are you sure you want to permanently delete ALL messages in this dead-letter queue? This action cannot be undone.`,
                { modal: true },
                'Purge All'
            );

            if (confirm !== 'Purge All') {
                return;
            }

            try {
                const deletedCount = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Purging dead-letter queue...',
                        cancellable: false
                    },
                    async () => {
                        return serviceBusService.purgeDeadLetterQueue(
                            item.namespace,
                            item.queueName,
                            item.topicName,
                            item.subscriptionName
                        );
                    }
                );

                vscode.window.showInformationMessage(
                    `Purged ${deletedCount} messages from dead-letter queue`
                );
                treeProvider.refresh();
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to purge dead-letter queue: ${errorMessage}`);
            }
        }
    );

    context.subscriptions.push(
        viewMessageCommand,
        peekMessagesCommand,
        resubmitMessageCommand,
        deleteMessageCommand,
        purgeDeadLetterCommand
    );
}

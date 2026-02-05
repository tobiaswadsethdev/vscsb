import * as vscode from 'vscode';
import { ServiceBusTreeProvider } from '../tree/serviceBusTreeProvider';
import { NamespaceTreeItem, ServiceBusTreeItem } from '../tree/treeItems';

export function registerNamespaceCommands(
    context: vscode.ExtensionContext,
    treeProvider: ServiceBusTreeProvider
): void {
    // Add Namespace Command
    const addNamespaceCommand = vscode.commands.registerCommand(
        'azureServiceBus.addNamespace',
        async () => {
            const namespace = await vscode.window.showInputBox({
                prompt: 'Enter the Service Bus namespace',
                placeHolder: 'mynamespace.servicebus.windows.net',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Namespace cannot be empty';
                    }
                    return null;
                }
            });

            if (namespace) {
                try {
                    treeProvider.addNamespace(namespace.trim());
                    vscode.window.showInformationMessage(
                        `Added namespace: ${namespace}`
                    );
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(
                        `Failed to add namespace: ${errorMessage}`
                    );
                }
            }
        }
    );

    // Remove Namespace Command
    const removeNamespaceCommand = vscode.commands.registerCommand(
        'azureServiceBus.removeNamespace',
        async (item?: NamespaceTreeItem) => {
            if (!item) {
                vscode.window.showWarningMessage('Please select a namespace to remove');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Are you sure you want to remove namespace "${item.namespace}"?`,
                { modal: true },
                'Remove'
            );

            if (confirm === 'Remove') {
                treeProvider.removeNamespace(item.namespace);
                vscode.window.showInformationMessage(
                    `Removed namespace: ${item.namespace}`
                );
            }
        }
    );

    // Refresh Command
    const refreshCommand = vscode.commands.registerCommand(
        'azureServiceBus.refresh',
        () => {
            treeProvider.refresh();
        }
    );

    // Refresh Node Command
    const refreshNodeCommand = vscode.commands.registerCommand(
        'azureServiceBus.refreshNode',
        (item?: ServiceBusTreeItem) => {
            treeProvider.refresh(item);
        }
    );

    context.subscriptions.push(
        addNamespaceCommand,
        removeNamespaceCommand,
        refreshCommand,
        refreshNodeCommand
    );
}

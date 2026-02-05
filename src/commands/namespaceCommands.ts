import * as vscode from 'vscode';
import { ServiceBusTreeProvider } from '../tree/serviceBusTreeProvider';
import { ServiceBusService } from '../servicebus/serviceBusService';
import { NamespaceTreeItem, ServiceBusTreeItem } from '../tree/treeItems';

export function registerNamespaceCommands(
    context: vscode.ExtensionContext,
    treeProvider: ServiceBusTreeProvider,
    serviceBusService: ServiceBusService
): void {
    // Add Namespace Command
    const addNamespaceCommand = vscode.commands.registerCommand(
        'azureServiceBus.addNamespace',
        async () => {
            // First, ask the user how they want to connect
            const authMethod = await vscode.window.showQuickPick(
                [
                    {
                        label: '$(key) Connection String',
                        description: 'Use a Service Bus connection string (recommended)',
                        value: 'connectionString'
                    },
                    {
                        label: '$(account) Azure AD',
                        description: 'Sign in with your Microsoft account',
                        value: 'azureAd'
                    }
                ],
                {
                    placeHolder: 'How do you want to connect to Service Bus?'
                }
            );

            if (!authMethod) {
                return;
            }

            if (authMethod.value === 'connectionString') {
                const connectionString = await vscode.window.showInputBox({
                    prompt: 'Enter the Service Bus connection string',
                    placeHolder: 'Endpoint=sb://mynamespace.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=...',
                    password: true,
                    validateInput: (value) => {
                        if (!value || value.trim().length === 0) {
                            return 'Connection string cannot be empty';
                        }
                        if (!value.includes('Endpoint=sb://') || !value.includes('SharedAccessKey')) {
                            return 'Invalid connection string format';
                        }
                        return null;
                    }
                });

                if (connectionString) {
                    try {
                        const namespace = serviceBusService.registerConnectionString(connectionString.trim());
                        if (namespace) {
                            // Store the connection string securely
                            await context.secrets.store(`azureServiceBus.connectionString.${namespace}`, connectionString.trim());
                            treeProvider.addNamespace(namespace);
                            vscode.window.showInformationMessage(
                                `Added namespace: ${namespace}`
                            );
                        } else {
                            vscode.window.showErrorMessage('Could not parse namespace from connection string');
                        }
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        vscode.window.showErrorMessage(
                            `Failed to add namespace: ${errorMessage}`
                        );
                    }
                }
            } else {
                // Azure AD authentication
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
                            `Added namespace: ${namespace} (using Azure AD authentication)`
                        );
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        vscode.window.showErrorMessage(
                            `Failed to add namespace: ${errorMessage}`
                        );
                    }
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
                // Remove stored connection string
                await context.secrets.delete(`azureServiceBus.connectionString.${item.namespace}`);
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

/**
 * Restore connection strings from secret storage on extension activation
 */
export async function restoreConnectionStrings(
    context: vscode.ExtensionContext,
    serviceBusService: ServiceBusService,
    namespaces: string[]
): Promise<void> {
    for (const namespace of namespaces) {
        const connectionString = await context.secrets.get(`azureServiceBus.connectionString.${namespace}`);
        if (connectionString) {
            serviceBusService.registerConnectionString(connectionString);
            console.log(`[ServiceBus] Restored connection string for ${namespace}`);
        }
    }
}

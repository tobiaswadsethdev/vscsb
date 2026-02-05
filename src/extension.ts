import * as vscode from 'vscode';
import { ServiceBusTreeProvider } from './tree/serviceBusTreeProvider';
import { ServiceBusService } from './servicebus/serviceBusService';
import { registerNamespaceCommands, restoreConnectionStrings } from './commands/namespaceCommands';
import { registerMessageCommands } from './commands/messageCommands';

let serviceBusService: ServiceBusService;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('Azure Service Bus Explorer is now active');

    // Initialize the Service Bus service
    serviceBusService = new ServiceBusService();

    // Create the tree data provider
    const treeProvider = new ServiceBusTreeProvider(context, serviceBusService);

    // Restore connection strings from secret storage
    const savedNamespaces = context.globalState.get<string[]>('azureServiceBus.namespaces', []);
    await restoreConnectionStrings(context, serviceBusService, savedNamespaces);

    // Register the tree view
    const treeView = vscode.window.createTreeView('azureServiceBusExplorer', {
        treeDataProvider: treeProvider,
        showCollapseAll: true
    });

    // Register commands
    registerNamespaceCommands(context, treeProvider, serviceBusService);
    registerMessageCommands(context, treeProvider, serviceBusService);

    // Add disposables
    context.subscriptions.push(treeView);

    // Show welcome message on first activation
    const hasShownWelcome = context.globalState.get<boolean>('azureServiceBus.hasShownWelcome', false);
    if (!hasShownWelcome) {
        vscode.window.showInformationMessage(
            'Azure Service Bus Explorer is ready! Click the Service Bus icon in the Activity Bar to get started.',
            'Add Namespace'
        ).then(selection => {
            if (selection === 'Add Namespace') {
                vscode.commands.executeCommand('azureServiceBus.addNamespace');
            }
        });
        context.globalState.update('azureServiceBus.hasShownWelcome', true);
    }
}

export async function deactivate(): Promise<void> {
    if (serviceBusService) {
        await serviceBusService.dispose();
    }
}

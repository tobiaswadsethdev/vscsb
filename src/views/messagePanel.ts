import * as vscode from 'vscode';
import { MessageInfo } from '../tree/treeItems';

export class MessagePanel {
    public static currentPanel: MessagePanel | undefined;
    private static readonly viewType = 'azureServiceBusMessage';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri, messageInfo: MessageInfo): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (MessagePanel.currentPanel) {
            MessagePanel.currentPanel._panel.reveal(column);
            MessagePanel.currentPanel._update(messageInfo);
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            MessagePanel.viewType,
            'Service Bus Message',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri]
            }
        );

        MessagePanel.currentPanel = new MessagePanel(panel, extensionUri, messageInfo);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        messageInfo: MessageInfo
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Set the webview's initial html content
        this._update(messageInfo);

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Update the content based on view changes
        this._panel.onDidChangeViewState(
            () => {
                if (this._panel.visible) {
                    // Panel became visible
                }
            },
            null,
            this._disposables
        );
    }

    public dispose(): void {
        MessagePanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    private _update(messageInfo: MessageInfo): void {
        const webview = this._panel.webview;
        this._panel.title = `Message: ${messageInfo.message.messageId || 'Unknown'}`;
        this._panel.webview.html = this._getHtmlForWebview(webview, messageInfo);
    }

    private _getHtmlForWebview(webview: vscode.Webview, messageInfo: MessageInfo): string {
        const { message, queueName, topicName, subscriptionName, isDeadLetter, namespace } = messageInfo;

        // Format the message body
        let bodyContent = '';
        try {
            if (message.body) {
                if (typeof message.body === 'string') {
                    try {
                        // Try to parse as JSON for pretty printing
                        const parsed = JSON.parse(message.body);
                        bodyContent = JSON.stringify(parsed, null, 2);
                    } catch {
                        bodyContent = message.body;
                    }
                } else if (typeof message.body === 'object') {
                    bodyContent = JSON.stringify(message.body, null, 2);
                } else {
                    bodyContent = String(message.body);
                }
            } else {
                bodyContent = '(empty)';
            }
        } catch {
            bodyContent = String(message.body);
        }

        // Build the location string
        const location = queueName
            ? `Queue: ${queueName}`
            : `Topic: ${topicName} / Subscription: ${subscriptionName}`;

        // Build application properties table
        const appProperties = message.applicationProperties || {};
        const appPropertiesRows = Object.entries(appProperties)
            .map(([key, value]) => `<tr><td>${this._escapeHtml(key)}</td><td>${this._escapeHtml(this._formatValue(value))}</td></tr>`)
            .join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Service Bus Message</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.5;
        }
        h1, h2, h3 {
            color: var(--vscode-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 8px;
        }
        .section {
            margin-bottom: 24px;
        }
        .property-grid {
            display: grid;
            grid-template-columns: 200px 1fr;
            gap: 8px;
        }
        .property-label {
            font-weight: bold;
            color: var(--vscode-descriptionForeground);
        }
        .property-value {
            word-break: break-all;
        }
        .dead-letter-warning {
            background-color: var(--vscode-inputValidation-warningBackground);
            border: 1px solid var(--vscode-inputValidation-warningBorder);
            padding: 12px;
            border-radius: 4px;
            margin-bottom: 16px;
        }
        .dead-letter-warning h3 {
            margin-top: 0;
            color: var(--vscode-inputValidation-warningForeground);
            border: none;
            padding-bottom: 0;
        }
        pre {
            background-color: var(--vscode-textBlockQuote-background);
            border: 1px solid var(--vscode-panel-border);
            padding: 16px;
            border-radius: 4px;
            overflow-x: auto;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th, td {
            text-align: left;
            padding: 8px;
            border: 1px solid var(--vscode-panel-border);
        }
        th {
            background-color: var(--vscode-textBlockQuote-background);
        }
        .badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
        }
        .badge-active {
            background-color: var(--vscode-testing-iconPassed);
            color: white;
        }
        .badge-deadletter {
            background-color: var(--vscode-testing-iconFailed);
            color: white;
        }
    </style>
</head>
<body>
    <h1>Service Bus Message</h1>

    <div class="section">
        <span class="badge ${isDeadLetter ? 'badge-deadletter' : 'badge-active'}">
            ${isDeadLetter ? 'Dead Letter' : 'Active'}
        </span>
    </div>

    ${isDeadLetter ? `
    <div class="dead-letter-warning">
        <h3>Dead Letter Information</h3>
        <div class="property-grid">
            <span class="property-label">Reason:</span>
            <span class="property-value">${this._escapeHtml(message.deadLetterReason || 'Unknown')}</span>
            <span class="property-label">Error Description:</span>
            <span class="property-value">${this._escapeHtml(message.deadLetterErrorDescription || 'N/A')}</span>
            <span class="property-label">Source:</span>
            <span class="property-value">${this._escapeHtml(message.deadLetterSource || 'N/A')}</span>
        </div>
    </div>
    ` : ''}

    <div class="section">
        <h2>Message Properties</h2>
        <div class="property-grid">
            <span class="property-label">Message ID:</span>
            <span class="property-value">${this._escapeHtml(message.messageId?.toString() || 'N/A')}</span>
            <span class="property-label">Namespace:</span>
            <span class="property-value">${this._escapeHtml(namespace)}</span>
            <span class="property-label">Location:</span>
            <span class="property-value">${this._escapeHtml(location)}</span>
            <span class="property-label">Sequence Number:</span>
            <span class="property-value">${message.sequenceNumber?.toString() || 'N/A'}</span>
            <span class="property-label">Enqueued Time:</span>
            <span class="property-value">${message.enqueuedTimeUtc?.toISOString() || 'N/A'}</span>
            <span class="property-label">Content Type:</span>
            <span class="property-value">${this._escapeHtml(message.contentType || 'N/A')}</span>
            <span class="property-label">Correlation ID:</span>
            <span class="property-value">${this._escapeHtml(message.correlationId?.toString() || 'N/A')}</span>
            <span class="property-label">Subject:</span>
            <span class="property-value">${this._escapeHtml(message.subject || 'N/A')}</span>
            <span class="property-label">Reply To:</span>
            <span class="property-value">${this._escapeHtml(message.replyTo || 'N/A')}</span>
            <span class="property-label">Time to Live:</span>
            <span class="property-value">${message.timeToLive ? `${message.timeToLive}ms` : 'N/A'}</span>
            <span class="property-label">Delivery Count:</span>
            <span class="property-value">${message.deliveryCount ?? 'N/A'}</span>
            <span class="property-label">Session ID:</span>
            <span class="property-value">${this._escapeHtml(message.sessionId || 'N/A')}</span>
        </div>
    </div>

    ${Object.keys(appProperties).length > 0 ? `
    <div class="section">
        <h2>Application Properties</h2>
        <table>
            <thead>
                <tr>
                    <th>Key</th>
                    <th>Value</th>
                </tr>
            </thead>
            <tbody>
                ${appPropertiesRows}
            </tbody>
        </table>
    </div>
    ` : ''}

    <div class="section">
        <h2>Message Body</h2>
        <pre>${this._escapeHtml(bodyContent)}</pre>
    </div>
</body>
</html>`;
    }

    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    private _formatValue(value: unknown): string {
        if (value === null || value === undefined) {
            return 'N/A';
        }
        if (value instanceof Date) {
            return value.toISOString();
        }
        if (typeof value === 'object') {
            const obj = value as any;

            // Check if it's an AMQP datetime-offset (used by Azure Service Bus)
            // Format: { type: {...}, value: {0:..., 1:..., ...7:...}, descriptor: { value: "com.microsoft:datetime-offset" } }
            if (obj.descriptor?.value === 'com.microsoft:datetime-offset' && obj.value) {
                try {
                    // The value is 8 bytes representing ticks (100-nanosecond intervals since 0001-01-01)
                    // stored in big-endian format
                    const bytes = obj.value;
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
                    console.error('Failed to parse datetime-offset:', e);
                    return JSON.stringify(value);
                }
            }

            // Check if it's a Date-like object with timestamp (Long format)
            if ('low' in obj && 'high' in obj && !('type' in obj)) {
                // This is likely a Long number (used for timestamps/sequence numbers)
                try {
                    const num = obj.low + obj.high * 0x100000000;
                    // Check if it looks like a timestamp (milliseconds since epoch)
                    if (num > 1000000000000 && num < 2000000000000) {
                        return new Date(num).toISOString();
                    }
                    return num.toString();
                } catch {
                    return JSON.stringify(value);
                }
            }

            try {
                return JSON.stringify(value, null, 2);
            } catch {
                return String(value);
            }
        }
        return String(value);
    }
}

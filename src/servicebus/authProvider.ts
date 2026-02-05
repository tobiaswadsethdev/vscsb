import * as vscode from 'vscode';
import { TokenCredential, AccessToken } from '@azure/identity';

/**
 * Custom credential that uses VS Code's built-in Microsoft authentication
 */
export class VSCodeAzureCredential implements TokenCredential {
    private static readonly AZURE_SCOPES = ['https://servicebus.azure.net/.default'];
    private static readonly AUTH_PROVIDER_ID = 'microsoft';

    async getToken(scopes: string | string[]): Promise<AccessToken> {
        const scopeArray = Array.isArray(scopes) ? scopes : [scopes];

        try {
            console.log(`[ServiceBus Auth] Requesting token for scopes: ${scopeArray.join(', ')}`);

            // Use VS Code's built-in Microsoft authentication
            const session = await vscode.authentication.getSession(
                VSCodeAzureCredential.AUTH_PROVIDER_ID,
                scopeArray,
                { createIfNone: true }
            );

            if (!session) {
                throw new Error('Failed to get authentication session');
            }

            console.log(`[ServiceBus Auth] Got session for account: ${session.account.label}`);

            return {
                token: session.accessToken,
                expiresOnTimestamp: Date.now() + 3600 * 1000 // Assume 1 hour validity
            };
        } catch (error) {
            console.error(`[ServiceBus Auth] Authentication failed:`, error);
            throw new Error(`Azure authentication failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Check if the user is currently signed in
     */
    static async isSignedIn(): Promise<boolean> {
        try {
            const session = await vscode.authentication.getSession(
                VSCodeAzureCredential.AUTH_PROVIDER_ID,
                VSCodeAzureCredential.AZURE_SCOPES,
                { createIfNone: false }
            );
            return session !== undefined;
        } catch {
            return false;
        }
    }

    /**
     * Sign out from Azure
     */
    static async signOut(): Promise<void> {
        // VS Code doesn't provide a direct sign-out API
        // Users need to sign out via the Accounts menu
        vscode.window.showInformationMessage(
            'To sign out, click on the account icon in the bottom left corner and sign out from your Microsoft account.'
        );
    }
}

/**
 * Get credential for Azure Service Bus operations
 */
export function getAzureCredential(): TokenCredential {
    return new VSCodeAzureCredential();
}

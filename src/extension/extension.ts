import * as vscode from 'vscode';
import { UserDataManager } from './core/userDataManager';
import { CodegenService } from './services/codegenService';
import { CookieService } from './services/cookieService';
import { EnvironmentService } from './services/environmentService';
import { HistoryService } from './services/historyService';
import { RequestRunner } from './services/requestRunner';
import { StudioEditorProvider } from './studioEditorProvider';
import { WebviewToHost } from '../shared/types';

export async function activate(context: vscode.ExtensionContext) {
    await UserDataManager.initialize().catch(() => undefined);

    const environments = new EnvironmentService();
    const history = new HistoryService(context.globalStorageUri);
    const cookies = new CookieService();
    const runner = new RequestRunner(cookies, history);
    const provider = new StudioEditorProvider(context, environments, history, cookies, runner, new CodegenService());

    context.subscriptions.push(
        environments, history, cookies, provider,
        vscode.window.registerCustomEditorProvider(StudioEditorProvider.viewType, provider, {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: false,
        }),
        vscode.commands.registerCommand('restClientStudio.open', async (uri?: vscode.Uri) => {
            const target = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;
            if (!target) {
                vscode.window.showInformationMessage('Open a .http or .rest file first.');
                return;
            }
            await vscode.commands.executeCommand('vscode.openWith', target, StudioEditorProvider.viewType);
        }),
        vscode.commands.registerCommand('restClientStudio.openAsText', async (uri?: vscode.Uri) => {
            const target = uri instanceof vscode.Uri ? uri : provider.activeDocument?.uri;
            if (target) {
                await vscode.commands.executeCommand('vscode.openWith', target, 'default');
            }
        }),
        vscode.commands.registerCommand('restClientStudio.clearHistory', () => history.clear()),
        // internal, used by the end-to-end tests
        vscode.commands.registerCommand('restClientStudio._sessions', () =>
            provider.getSessions().map(({ uri, ready }) => ({ uri, ready }))),
        vscode.commands.registerCommand('restClientStudio._sendFromWebview', async (uri: string, index: number) => {
            await provider.getSessions().find(s => s.uri === uri)?.handle({ type: 'send', index });
            return (await history.getAll())[0];
        }),
        vscode.commands.registerCommand('restClientStudio._postFromWebview', async (uri: string, message: WebviewToHost) => {
            await provider.getSessions().find(s => s.uri === uri)?.handle(message);
        }),
        vscode.commands.registerCommand('restClientStudio.clearCookies', () => cookies.clear()),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('restClientStudio.openByDefault')) {
                void syncEditorAssociations();
            }
        }),
    );
    // only touch the user's settings when the option is (or was) in use
    if (vscode.workspace.getConfiguration('restClientStudio').inspect('openByDefault')?.globalValue !== undefined) {
        void syncEditorAssociations();
    }
}

const associationPatterns = ['*.http', '*.rest'];

/** Mirrors `restClientStudio.openByDefault` into the user's `workbench.editorAssociations`. */
async function syncEditorAssociations() {
    const openByDefault = vscode.workspace.getConfiguration('restClientStudio').get<boolean>('openByDefault', false);
    const workbench = vscode.workspace.getConfiguration('workbench');
    const current = { ...(workbench.inspect<Record<string, string>>('editorAssociations')?.globalValue ?? {}) };
    let changed = false;
    for (const pattern of associationPatterns) {
        if (openByDefault && current[pattern] !== StudioEditorProvider.viewType) {
            current[pattern] = StudioEditorProvider.viewType;
            changed = true;
        } else if (!openByDefault && current[pattern] === StudioEditorProvider.viewType) {
            delete current[pattern];
            changed = true;
        }
    }
    if (changed) {
        await workbench.update('editorAssociations', current, vscode.ConfigurationTarget.Global);
    }
}

export function deactivate() {
}

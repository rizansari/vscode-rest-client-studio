import { randomBytes } from 'crypto';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import { MimeUtility } from './core/mimeUtility';
import { formatHeaders } from './core/misc';
import {
    addRequest, deleteRequest, displayName, duplicateRequest, emptyRequest, minimalEdit, moveRequest, parseHttpFile,
    updateFileVariables, updateRequest
} from './model/httpFile';
import { CodegenService } from './services/codegenService';
import { CookieService } from './services/cookieService';
import { EnvironmentService } from './services/environmentService';
import { HistoryService } from './services/historyService';
import { CancelledError, RequestRunner } from './services/requestRunner';
import { listVariables } from './services/variableService';
import { HostToWebview, StudioConfig, WebviewToHost } from '../shared/types';

interface Session {
    document: vscode.TextDocument;
    panel: vscode.WebviewPanel;
    post(message: HostToWebview): void;
    pendingSelect?: number;
    /** Set once the webview script has loaded and rendered. */
    ready: boolean;
    handle(message: WebviewToHost): Promise<void>;
}

export class StudioEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
    public static readonly viewType = 'restClientStudio.editor';

    private readonly sessions = new Set<Session>();
    private readonly disposables: vscode.Disposable[] = [];
    private activeSession: Session | undefined;
    /** Index to select once a session for this URI opens (history "open"). */
    private readonly selectOnOpen = new Map<string, number>();

    public constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly environments: EnvironmentService,
        private readonly history: HistoryService,
        private readonly cookies: CookieService,
        private readonly runner: RequestRunner,
        private readonly codegen: CodegenService) {

        this.disposables.push(
            environments.onDidChange(() => this.broadcastEnvironment()),
            history.onDidChange(entries => this.broadcast({ type: 'history', entries })),
            cookies.onDidChange(async () => this.broadcast({ type: 'cookies', cookies: await this.cookies.list().catch(() => []) })),
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('restClientStudio')) {
                    this.broadcast({ type: 'config', config: getConfig() });
                }
            }),
        );
    }

    public get activeDocument(): vscode.TextDocument | undefined {
        return this.activeSession?.document;
    }

    /** Test hook: the open sessions, and a way to feed them webview messages. */
    public getSessions() {
        return [...this.sessions].map(s => ({ uri: s.document.uri.toString(), ready: s.ready, handle: s.handle }));
    }

    public selectWhenOpened(uri: vscode.Uri, index: number) {
        const session = [...this.sessions].find(s => s.document.uri.toString() === uri.toString());
        if (session) {
            session.post({ type: 'select', index });
        } else {
            this.selectOnOpen.set(uri.toString(), index);
        }
    }

    public async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
        const webviewRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
        panel.webview.options = { enableScripts: true, localResourceRoots: [webviewRoot] };
        panel.webview.html = this.getHtml(panel.webview, webviewRoot);

        const session: Session = {
            document,
            panel,
            post: message => { void panel.webview.postMessage(message); },
            pendingSelect: this.selectOnOpen.get(document.uri.toString()),
            ready: false,
            handle: async () => undefined,
        };
        this.selectOnOpen.delete(document.uri.toString());
        this.sessions.add(session);
        if (panel.active) {
            this.activeSession = session;
        }

        // Edits made by the webview are applied one after another against the latest text.
        let editQueue: Promise<unknown> = Promise.resolve();
        let applyingEdits = 0;
        let externalChange = false;
        let changeTimer: NodeJS.Timeout | undefined;

        const applyText = async (transform: (text: string) => string) => {
            const before = document.getText();
            const after = transform(before);
            const edit = minimalEdit(before, after);
            if (!edit) {
                return;
            }
            const workspaceEdit = new vscode.WorkspaceEdit();
            workspaceEdit.replace(document.uri, new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)), edit.text);
            applyingEdits++;
            try {
                await vscode.workspace.applyEdit(workspaceEdit);
            } finally {
                applyingEdits--;
            }
        };
        const enqueueEdit = (transform: (text: string) => string) => {
            editQueue = editQueue.then(() => applyText(transform)).catch(e => {
                vscode.window.showErrorMessage(`REST Client Studio: ${e?.message ?? e}`);
                // resync the webview with the document
                session.post({ type: 'documentChanged', file: parseHttpFile(document.getText()), source: 'external' });
            });
            return editQueue;
        };

        const pushVariables = async () => {
            session.post({ type: 'variables', variables: await listVariables(document).catch(() => []) });
        };

        const disposables: vscode.Disposable[] = [
            vscode.workspace.onDidChangeTextDocument(e => {
                if (e.document.uri.toString() !== document.uri.toString() || e.contentChanges.length === 0) {
                    return;
                }
                if (applyingEdits === 0) {
                    externalChange = true;
                }
                clearTimeout(changeTimer);
                changeTimer = setTimeout(() => {
                    const source = externalChange ? 'external' : 'self';
                    externalChange = false;
                    session.post({ type: 'documentChanged', file: parseHttpFile(document.getText()), source });
                    void pushVariables();
                }, 60);
            }),
            panel.onDidChangeViewState(e => {
                if (e.webviewPanel.active) {
                    this.activeSession = session;
                }
            }),
            panel.webview.onDidReceiveMessage((message: WebviewToHost) => session.handle(message)),
        ];
        session.handle = message => this.handleMessage(session, message, enqueueEdit, pushVariables);

        panel.onDidDispose(() => {
            clearTimeout(changeTimer);
            disposables.forEach(d => d.dispose());
            this.sessions.delete(session);
            if (this.activeSession === session) {
                this.activeSession = undefined;
            }
        });
    }

    private async handleMessage(
        session: Session,
        message: WebviewToHost,
        enqueueEdit: (transform: (text: string) => string) => Promise<unknown>,
        pushVariables: () => Promise<void>) {
        const { document } = session;
        switch (message.type) {
            case 'ready': {
                session.ready = true;
                session.post({
                    type: 'init',
                    fileName: path.basename(document.fileName),
                    file: parseHttpFile(document.getText()),
                    env: await this.environments.getInfo(document.uri),
                    variables: await listVariables(document).catch(() => []),
                    codegenTargets: this.codegen.getTargets(),
                    config: getConfig(),
                    selectIndex: session.pendingSelect,
                });
                session.pendingSelect = undefined;
                session.post({ type: 'history', entries: await this.history.getAll() });
                session.post({ type: 'cookies', cookies: await this.cookies.list().catch(() => []) });
                break;
            }
            case 'updateRequest':
                await enqueueEdit(text => updateRequest(text, message.index, message.request));
                break;
            case 'addRequest':
                await enqueueEdit(text => addRequest(text, message.request ?? emptyRequest(), message.afterIndex));
                break;
            case 'duplicateRequest':
                await enqueueEdit(text => duplicateRequest(text, message.index));
                break;
            case 'deleteRequest':
                await enqueueEdit(text => deleteRequest(text, message.index));
                break;
            case 'moveRequest':
                await enqueueEdit(text => moveRequest(text, message.from, message.to));
                break;
            case 'updateFileVariables':
                await enqueueEdit(text => updateFileVariables(text, message.variables));
                break;
            case 'save':
                await document.save();
                break;
            case 'send':
                await enqueueEdit(text => text);   // wait for pending edits from the webview
                await this.send(session, message.index, pushVariables);
                break;
            case 'cancel':
                this.runner.cancel(document, message.index);
                break;
            case 'selectEnv':
                await this.environments.select(message.name);
                break;
            case 'saveEnvironments':
                await this.environments.save(message.variables, document.uri)
                    .catch(e => vscode.window.showErrorMessage(`Unable to save environments: ${e?.message ?? e}`));
                break;
            case 'openAsText': {
                const line = message.line ?? 0;
                const position = new vscode.Position(line, 0);
                await vscode.window.showTextDocument(document, {
                    viewColumn: vscode.ViewColumn.Beside,
                    selection: new vscode.Range(position, position),
                });
                break;
            }
            case 'generateCode': {
                await enqueueEdit(text => text);
                try {
                    const { httpRequest } = await this.runner.prepare(document, message.index);
                    const code = this.codegen.generate(httpRequest, message.target, message.client);
                    session.post({ type: 'codeSnippet', target: message.target, client: message.client, code });
                } catch (e) {
                    if (!(e instanceof CancelledError)) {
                        session.post({ type: 'codeSnippet', target: message.target, client: message.client, code: '', error: e?.message ?? String(e) });
                    }
                }
                break;
            }
            case 'copyAsCurl': {
                await enqueueEdit(text => text);
                try {
                    const { httpRequest } = await this.runner.prepare(document, message.index);
                    await vscode.env.clipboard.writeText(this.codegen.generate(httpRequest, 'shell', 'curl'));
                    vscode.window.setStatusBarMessage('$(check) Copied request as cURL', 3000);
                } catch (e) {
                    if (!(e instanceof CancelledError)) {
                        vscode.window.showErrorMessage(`Unable to copy as cURL: ${e?.message ?? e}`);
                    }
                }
                break;
            }
            case 'copyText':
                await vscode.env.clipboard.writeText(message.text);
                vscode.window.setStatusBarMessage('$(check) Copied to clipboard', 2000);
                break;
            case 'saveResponse':
                await this.saveResponse(session, message.index, message.bodyOnly);
                break;
            case 'getHistory':
                session.post({ type: 'history', entries: await this.history.getAll() });
                break;
            case 'clearHistory':
                await this.history.clear();
                break;
            case 'openHistory':
                await this.openHistory(session, message.id, message.mode, enqueueEdit);
                break;
            case 'getCookies':
                session.post({ type: 'cookies', cookies: await this.cookies.list().catch(() => []) });
                break;
            case 'deleteCookie':
                await this.cookies.remove(message.cookie);
                break;
            case 'clearCookies':
                await this.cookies.clear();
                break;
            case 'pickFile': {
                const picked = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    defaultUri: vscode.Uri.file(path.dirname(document.fileName)),
                    openLabel: 'Use as request body',
                });
                let relative: string | undefined;
                if (picked?.[0]) {
                    relative = path.relative(path.dirname(document.fileName), picked[0].fsPath).split(path.sep).join('/');
                    if (!relative.startsWith('.')) {
                        relative = `./${relative}`;
                    }
                }
                session.post({ type: 'filePicked', requestId: message.requestId, path: relative });
                break;
            }
            case 'showError':
                vscode.window.showErrorMessage(message.message);
                break;
        }
    }

    private async send(session: Session, index: number, pushVariables: () => Promise<void>) {
        session.post({ type: 'requestStarted', index });
        try {
            const response = await this.runner.send(session.document, index);
            session.post({ type: 'requestFinished', index, response });
            await pushVariables();
        } catch (e) {
            const cancelled = e instanceof CancelledError;
            session.post({ type: 'requestFailed', index, error: cancelled ? 'Request cancelled' : (e?.message ?? String(e)), cancelled });
        }
    }

    private async saveResponse(session: Session, index: number, bodyOnly: boolean) {
        const response = this.runner.getLastResponse(session.document, index);
        if (!response) {
            return;
        }
        const extension = bodyOnly
            ? MimeUtility.getExtension(response.contentType, vscode.workspace.getConfiguration('rest-client', session.document.uri)
                .get<Record<string, string>>('mimeAndFileExtensionMapping', {})) || 'txt'
            : 'http';
        const name = `response-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
        const target = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(path.dirname(session.document.fileName), name)),
        });
        if (!target) {
            return;
        }
        if (bodyOnly) {
            await fs.writeFile(target.fsPath, response.bodyBuffer);
        } else {
            const statusLine = `HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}`;
            await fs.writeFile(target.fsPath, `${statusLine}\n${formatHeaders(response.headers)}\n${response.body}`);
        }
        const open = await vscode.window.showInformationMessage(`Saved response to ${path.basename(target.fsPath)}`, 'Open');
        if (open) {
            await vscode.commands.executeCommand('vscode.open', target);
        }
    }

    private async openHistory(session: Session, id: string, mode: 'open' | 'insert', enqueueEdit: (transform: (text: string) => string) => Promise<unknown>) {
        const entry = await this.history.get(id);
        if (!entry) {
            return;
        }
        if (mode === 'insert' || !entry.fileUri) {
            const request = parseHttpFile(entry.requestText).requests[0];
            if (request) {
                await enqueueEdit(text => addRequest(text, { ...request, title: entry.title ?? displayName(request) }));
                session.post({ type: 'select', index: parseHttpFile(session.document.getText()).requests.length - 1 });
            }
            return;
        }

        const uri = vscode.Uri.parse(entry.fileUri);
        let index = -1;
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const requests = parseHttpFile(doc.getText()).requests;
            index = requests.findIndex(r => displayName(r) === entry.title);
        } catch {
            vscode.window.showWarningMessage(`${entry.fileName ?? 'The file'} no longer exists`);
            return;
        }
        if (uri.toString() === session.document.uri.toString()) {
            if (index >= 0) {
                session.post({ type: 'select', index });
            }
            return;
        }
        if (index >= 0) {
            this.selectWhenOpened(uri, index);
        }
        await vscode.commands.executeCommand('vscode.openWith', uri, StudioEditorProvider.viewType);
    }

    private async broadcastEnvironment() {
        for (const session of this.sessions) {
            session.post({ type: 'env', env: await this.environments.getInfo(session.document.uri) });
            session.post({ type: 'variables', variables: await listVariables(session.document).catch(() => []) });
        }
    }

    private broadcast(message: HostToWebview) {
        for (const session of this.sessions) {
            session.post(message);
        }
    }

    private getHtml(webview: vscode.Webview, root: vscode.Uri): string {
        const nonce = randomBytes(16).toString('base64');
        const script = webview.asWebviewUri(vscode.Uri.joinPath(root, 'index.js'));
        const style = webview.asWebviewUri(vscode.Uri.joinPath(root, 'index.css'));
        const csp = [
            `default-src 'none'`,
            `img-src ${webview.cspSource} data: blob:`,
            `style-src ${webview.cspSource} 'unsafe-inline'`,
            `font-src ${webview.cspSource}`,
            `script-src 'nonce-${nonce}'`,
            `frame-src blob: data:`,
        ].join('; ');
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>REST Client Studio</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" type="module" src="${script}"></script>
</body>
</html>`;
    }

    public dispose() {
        this.disposables.forEach(d => d.dispose());
    }
}

function getConfig(): StudioConfig {
    const config = vscode.workspace.getConfiguration('restClientStudio');
    return { responsePane: config.get<'bottom' | 'right'>('responsePane', 'bottom') };
}

// Runs inside the Extension Development Host.
const assert = require('assert');
const http = require('http');
const path = require('path');
const vscode = require('vscode');

const wait = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(check, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const value = await check();
        if (value) {
            return value;
        }
        await wait(100);
    }
    throw new Error('timed out');
}

exports.run = async function () {
    const server = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ path: req.url, method: req.method }));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    try {
        const extension = vscode.extensions.all.find(e => e.packageJSON.name === 'rest-client-studio');
        assert.ok(extension, 'extension is installed');
        await extension.activate();

        const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const file = vscode.Uri.file(path.join(folder, 'e2e.http'));
        await vscode.workspace.fs.writeFile(file, Buffer.from(`@host = http://127.0.0.1:${port}\n\n### Ping\nGET {{host}}/ping\n`));

        await vscode.commands.executeCommand('restClientStudio.open', file);
        await waitFor(() => extension.isActive);
        const tab = await waitFor(() => vscode.window.tabGroups.activeTabGroup.activeTab);
        assert.ok(tab.input instanceof vscode.TabInputCustom, 'a custom editor is open');
        assert.strictEqual(tab.input.viewType, 'restClientStudio.editor');

        // the webview script loaded under the CSP, rendered and said hello
        await waitFor(async () => (await vscode.commands.executeCommand('restClientStudio._sessions'))
            .some(s => s.uri === file.toString() && s.ready));

        // a request sent the way the webview does it, through the bundled code
        const entry = await vscode.commands.executeCommand('restClientStudio._sendFromWebview', file.toString(), 0);
        assert.strictEqual(entry.statusCode, 200, JSON.stringify(entry));
        assert.strictEqual(entry.url, `http://127.0.0.1:${port}/ping`);

        // code generation works in the bundle (httpsnippet)
        await vscode.env.clipboard.writeText('');
        await vscode.commands.executeCommand('restClientStudio._postFromWebview', file.toString(), { type: 'copyAsCurl', index: 0 });
        const curl = await vscode.env.clipboard.readText();
        assert.ok(curl.includes(`--url http://127.0.0.1:${port}/ping`) || curl.includes(`'http://127.0.0.1:${port}/ping'`), curl);

        // the document behind the custom editor is the plain text file
        const document = vscode.workspace.textDocuments.find(d => d.uri.fsPath === file.fsPath);
        assert.ok(document);

        // an edit made in the UI lands in the document and marks it dirty, touching only the header block
        await vscode.commands.executeCommand('restClientStudio._postFromWebview', file.toString(), {
            type: 'updateRequest',
            index: 0,
            request: {
                title: 'Ping', metadata: { noRedirect: false, noCookieJar: false, prompts: [] },
                method: 'GET', url: '{{host}}/ping', disabledParams: [],
                headers: [{ key: 'Accept', value: 'application/json', enabled: true }], body: '',
            },
        });
        assert.strictEqual(document.getText(), `@host = http://127.0.0.1:${port}\n\n### Ping\nGET {{host}}/ping\nAccept: application/json\n`);
        assert.ok(document.isDirty);
        await vscode.commands.executeCommand('restClientStudio._postFromWebview', file.toString(), { type: 'save' });
        assert.ok(!document.isDirty);
        await vscode.commands.executeCommand('restClientStudio._postFromWebview', file.toString(), { type: 'addRequest' });
        assert.ok(document.getText().endsWith('\n\n### New Request\nGET https://httpbin.org/get\n'), JSON.stringify(document.getText()));
        await vscode.commands.executeCommand('restClientStudio._postFromWebview', file.toString(), { type: 'deleteRequest', index: 1 });
        assert.strictEqual(document.getText(), `@host = http://127.0.0.1:${port}\n\n### Ping\nGET {{host}}/ping\nAccept: application/json\n`);

        // an external edit is picked up (the webview is told through documentChanged)
        const edit = new vscode.WorkspaceEdit();
        edit.insert(file, new vscode.Position(document.lineCount, 0), '\n### Second\nPOST {{host}}/second\n');
        assert.ok(await vscode.workspace.applyEdit(edit));
        assert.ok(document.getText().includes('### Second'));

        await vscode.commands.executeCommand('restClientStudio.openAsText');
        await waitFor(() => vscode.window.activeTextEditor?.document.uri.fsPath === file.fsPath);
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
        console.log('E2E OK');
    } finally {
        server.close();
        const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;
        await vscode.workspace.fs.delete(vscode.Uri.file(path.join(folder, 'e2e.http'))).then(undefined, () => undefined);
    }
};

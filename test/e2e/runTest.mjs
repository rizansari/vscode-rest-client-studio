import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

// set when this runs from a terminal inside VS Code; it would make the downloaded VS Code act as plain Node
delete process.env.ELECTRON_RUN_AS_NODE;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let vscodeExecutablePath = await downloadAndUnzipVSCode();
// newer macOS builds name the binary "Code" instead of "Electron"
if (!fs.existsSync(vscodeExecutablePath)) {
    vscodeExecutablePath = path.join(path.dirname(vscodeExecutablePath), 'Code');
}

await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'test/e2e/suite.cjs'),
    launchArgs: [path.join(root, 'samples'), '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
    extensionTestsEnv: { VSC_REST_CLIENT_HOME: path.join(os.tmpdir(), `rest-client-studio-e2e-${process.pid}`) },
});

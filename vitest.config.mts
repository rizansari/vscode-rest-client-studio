import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            vscode: path.join(root, 'test/vscodeStub.ts'),
        },
    },
    esbuild: {
        jsx: 'automatic',
    },
    test: {
        include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
        env: {
            // keep the tests away from the real ~/.rest-client folder
            VSC_REST_CLIENT_HOME: path.join(os.tmpdir(), `rest-client-studio-test-${process.pid}`),
        },
    },
});

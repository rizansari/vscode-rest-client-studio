import * as esbuild from 'esbuild';
import * as fs from 'fs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

if (production) {
    // don't ship a source map left over from a dev build
    fs.rmSync('dist/extension.js.map', { force: true });
}

const ctx = await esbuild.context({
    entryPoints: ['src/extension/extension.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    // prefer ESM builds: jsonc-parser's UMD build uses dynamic requires esbuild can't follow
    mainFields: ['module', 'main'],
    sourcemap: !production,
    minify: production,
    logLevel: 'info',
});

if (watch) {
    await ctx.watch();
} else {
    await ctx.rebuild();
    await ctx.dispose();
}

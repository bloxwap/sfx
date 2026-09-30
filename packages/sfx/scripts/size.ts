// Bundle-size budget: bundles the published entry the way an app bundler would (minified, ESM),
// then gzips and brotli-compresses it. Fails when the gzipped size exceeds the budget.
import { build } from 'esbuild';
import { brotliCompressSync, gzipSync } from 'node:zlib';

// Custom recipe validation adds to the full API; play/bind still tree-shake it away.
const BUDGET_GZIP = 6144;

const entries: [label: string, contents: string][] = [
  ['full bundle', `export * from './dist/index.js';`],
  ['play() only', `export { play } from './dist/index.js';`],
  ['bind() only', `export { bind } from './dist/index.js';`],
];

let failed = false;
for (const [label, contents] of entries) {
  const result = await build({
    stdin: { contents, resolveDir: process.cwd(), loader: 'js' },
    bundle: true, minify: true, format: 'esm', write: false, treeShaking: true, target: 'es2022',
  });
  const code = result.outputFiles[0].contents;
  const gzip = gzipSync(code, { level: 9 }).length;
  const brotli = brotliCompressSync(code).length;
  console.log(`${label.padEnd(12)} ${String(code.length).padStart(6)} B min  ${String(gzip).padStart(5)} B gzip  ${String(brotli).padStart(5)} B brotli`);
  if (label === 'full bundle' && gzip > BUDGET_GZIP) {
    console.error(`::error::full bundle is ${gzip} B gzipped, over the ${BUDGET_GZIP} B budget`);
    failed = true;
  }
}
if (failed) process.exit(1);

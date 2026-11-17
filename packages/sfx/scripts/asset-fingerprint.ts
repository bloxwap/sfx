import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Invalidate baked audio when any renderer, encoder, recipe or build dependency changes. */
export function assetFingerprint(target: 'native' | 'hig'): string {
  const inputs = ['src/engine.ts', 'src/recipes.ts', 'src/wav.ts', 'scripts/asset-fingerprint.ts',
    ...(target === 'native' ? ['scripts/bake-native.ts'] : ['src/cli/index.ts', 'src/semantic.ts', 'scripts/export-approved.ts'])];
  const hash = createHash('sha256');
  hash.update('bun.lock\0').update(readFileSync(new URL('../../../bun.lock', import.meta.url)));
  for (const path of inputs) hash.update(path).update('\0').update(readFileSync(new URL(`../${path}`, import.meta.url))).update('\0');
  const lock = JSON.parse(readFileSync(new URL('../../../package-lock.json', import.meta.url), 'utf8'));
  for (const name of ['esbuild', 'playwright-core', 'node-web-audio-api']) {
    hash.update(name).update(JSON.stringify(lock.packages[`node_modules/${name}`]));
  }
  return hash.digest('hex');
}

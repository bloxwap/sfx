import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('check-publish-auth fails closed without a token and does not print secrets', () => {
  const script = fileURLToPath(new URL('../scripts/check-publish-auth.ts', import.meta.url));
  const env = { ...process.env, NODE_AUTH_TOKEN: '', NPM_TOKEN: '' };
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /NPM_TOKEN is missing/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /npm_[A-Za-z0-9]{8,}/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('check-publish-auth fails closed without a token and does not print secrets', () => {
  const script = fileURLToPath(new URL('../scripts/check-publish-auth.ts', import.meta.url));
  const env = { ...process.env, NODE_AUTH_TOKEN: '', NPM_TOKEN: '',
    ACTIONS_ID_TOKEN_REQUEST_URL: '', ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' };
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /NPM_TOKEN is missing/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /npm_[A-Za-z0-9]{8,}/);
});

for (const [url, token, succeeds] of [
  ['https://oidc.invalid/request', 'oidc-secret-sentinel', true],
  ['https://oidc.invalid/request', '', false],
  ['', 'oidc-secret-sentinel', false],
] as const) {
  test(`check-publish-auth requires both OIDC variables (${Boolean(url)}, ${Boolean(token)})`, () => {
    const script = fileURLToPath(new URL('../scripts/check-publish-auth.ts', import.meta.url));
    const env = { ...process.env, NODE_AUTH_TOKEN: '', NPM_TOKEN: '',
      ACTIONS_ID_TOKEN_REQUEST_URL: url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: token };
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status === 0, succeeds);
    assert.match(output, succeeds ? /Publishing will rely on npm trusted publishing/ : /NPM_TOKEN is missing/);
    assert.doesNotMatch(output, /oidc-secret-sentinel/);
  });
}

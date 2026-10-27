// Verify the transitional token when present. OIDC is validated by npm publish,
// because whoami and collaborator checks require a token. Never print tokens.
import { readFile } from 'node:fs/promises';

const { name } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string;
};
const token = process.env.NODE_AUTH_TOKEN || process.env.NPM_TOKEN;
if (typeof token !== 'string' || !token) {
  if (process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    console.log('::notice::Publishing will rely on npm trusted publishing (OIDC).');
    process.exit(0);
  }
  throw new Error(
    'NPM_TOKEN is missing. The Publish to npm job needs the org-level NPM_TOKEN secret with permission to publish this package.',
  );
}

const whoami = await fetch('https://registry.npmjs.org/-/whoami', {
  headers: { Authorization: `Bearer ${token}` },
  signal: AbortSignal.timeout(30_000),
});
if (!whoami.ok) {
  throw new Error(
    `npm token authentication failed (HTTP ${whoami.status}). Check the NPM_TOKEN org secret.`,
  );
}
const identity = await whoami.json() as { username?: unknown };
if (typeof identity.username !== 'string' || !identity.username) {
  throw new Error('npm whoami did not return a username.');
}

const escapedName = name.replace('/', '%2f');
const collaborators = await fetch(`https://registry.npmjs.org/-/package/${escapedName}/collaborators`, {
  headers: { Authorization: `Bearer ${token}` },
  signal: AbortSignal.timeout(30_000),
});
if (!collaborators.ok) {
  throw new Error(
    `npm collaborator check failed (HTTP ${collaborators.status}). The NPM_TOKEN secret must be able to publish ${name}.`,
  );
}
const access = await collaborators.json() as Record<string, unknown>;
const permission = access[identity.username];
if (permission !== 'write' && permission !== 'read-write' && permission !== true) {
  throw new Error(`npm token for ${identity.username} cannot publish ${name}.`);
}
console.log(`npm accepted the org NPM_TOKEN for ${name} as ${identity.username}.`);

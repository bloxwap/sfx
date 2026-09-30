// Build provenance separately so a new package can be published once with npm login,
// then switched to trusted publishing without losing provenance on its first version.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const env = process.env;
if (env.GITHUB_ACTIONS !== 'true') throw new Error('Run through the Prepare npm release workflow');
const directory = env.SFX_RELEASE_DIRECTORY;
const modules = env.SFX_NPM_MODULES;
if (!directory || !modules) throw new Error('Missing release directory or npm module path');
const manifest = JSON.parse(await readFile('packages/sfx/package.json', 'utf8')) as { name: string; version: string };
const tag = `v${manifest.version}`;
if (env.SFX_SOURCE_REF !== tag) throw new Error('Source tag must match the package version');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const tagCommit = execFileSync('git', ['rev-parse', `${tag}^{commit}`], { encoding: 'utf8' }).trim();
if (commit !== tagCommit) throw new Error('Checkout does not match the release tag');
const filename = `${manifest.name.replace(/^@/, '').replace('/', '-')}-${manifest.version}.tgz`;
const archive = await readFile(join(directory, filename));
const sha512 = createHash('sha512').update(archive).digest('hex');
const npmRequire = createRequire(join(modules, 'npm/package.json'));
const npa = npmRequire('npm-package-arg') as { resolve(name: string, version: string): unknown; toPurl(spec: unknown): string };
const sigstore = npmRequire('sigstore') as { attest(payload: Buffer, type: string): Promise<unknown>; verify(bundle: unknown): Promise<void> };
const subject = { name: npa.toPurl(npa.resolve(manifest.name, manifest.version)), digest: { sha512 } };
const repository = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}`;
const workflow = env.GITHUB_WORKFLOW_REF!.replace(`${env.GITHUB_REPOSITORY}/`, '');
const separator = workflow.lastIndexOf('@');
// The workflow comes from main; its package source comes from the checked-out release tag.
// npm requires the certificate-bound workflow repository to be the first dependency.
// Record the separately checked-out package source as a second dependency.
const statement = {
  _type: 'https://in-toto.io/Statement/v1',
  subject: [subject],
  predicateType: 'https://slsa.dev/provenance/v1',
  predicate: {
    buildDefinition: {
      buildType: 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
      externalParameters: {
        workflow: { ref: workflow.slice(separator + 1), repository, path: workflow.slice(0, separator) },
        source_ref: tag,
        source_commit: commit,
      },
      internalParameters: { github: { event_name: env.GITHUB_EVENT_NAME, repository_id: env.GITHUB_REPOSITORY_ID, repository_owner_id: env.GITHUB_REPOSITORY_OWNER_ID } },
      resolvedDependencies: [
        { uri: `git+${repository}@${env.GITHUB_REF}`, digest: { gitCommit: env.GITHUB_SHA } },
        { uri: `git+${repository}@refs/tags/${tag}`, digest: { gitCommit: commit } },
      ],
    },
    runDetails: {
      builder: { id: `https://github.com/actions/runner/${env.RUNNER_ENVIRONMENT}` },
      metadata: { invocationId: `${repository}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}` },
    },
  },
};
const bundle = await sigstore.attest(Buffer.from(JSON.stringify(statement)), 'application/vnd.in-toto+json');
await sigstore.verify(bundle);
await writeFile(join(directory, 'provenance.sigstore'), JSON.stringify(bundle));
await writeFile(join(directory, 'SHA512SUMS'), `${sha512}  ${filename}\n`);
console.log(`Verified signed provenance for ${manifest.name}@${manifest.version}, source ${commit}`);

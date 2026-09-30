import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const argument = process.argv[2] ?? '0.1.0';
const archive = argument.endsWith('.tgz');
if (!archive && !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(argument)) throw new Error('Pass an exact published version or a local .tgz for rehearsal');
const spec = archive ? resolve(argument) : `@bloxwap/sfx@${argument}`;
const scratch = await mkdtemp(join(tmpdir(), 'sfx-registry-smoke-'));
const servers: ReturnType<typeof spawn>[] = [];
async function command(cmd: string, args: string[], cwd: string): Promise<void> {
  const child = spawn(cmd, args, { cwd, stdio: 'inherit', env: process.env });
  await new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} failed (${code})`)));
  });
}
async function serve(cwd: string, args: string[], port: number): Promise<void> {
  const child = spawn('npx', args, { cwd, stdio: 'inherit', detached: true });
  servers.push(child);
  for (let attempt = 0; attempt < 200; attempt++) {
    if (child.exitCode !== null) throw new Error('Consumer server exited before readiness');
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) return; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Consumer server did not become ready');
}
const client = `'use client';
import { useEffect, useState } from 'react';
import { bind, play, preload, getOutput } from '@bloxwap/sfx';
import { recipes, type Recipe } from '@bloxwap/sfx/recipes';
const typedRecipe: Recipe = recipes.success;
export function Client() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const w = window as any;
    w.sfx = { play, getOutput }; w.starts = 0; w.contexts = 0;
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) { super(options); w.contexts++; }
      createBufferSource() { const node = super.createBufferSource(); const start = node.start.bind(node); node.start = (...args: Parameters<typeof start>) => { w.starts++; start(...args); }; return node; }
      createOscillator() { const node = super.createOscillator(); const start = node.start.bind(node); node.start = (...args: Parameters<typeof start>) => { w.starts++; start(...args); }; return node; }
    };
    const unbind = bind();
    preload().then(() => setReady(true));
    return () => { unbind(); window.AudioContext = Native; };
  }, []);
  return <main><h1>{ready ? 'Ready' : 'Loading'}</h1><p>Recipe level {typedRecipe.level}</p><button id="bound" data-sound-press data-sound-release>Bound</button><button id="success" onClick={() => play('success')}>Success</button></main>;
}
`;
try {
  for (const framework of ['vite', 'next'] as const) {
    const directory = join(scratch, framework);
    await mkdir(directory);
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: `sfx-smoke-${framework}`, private: true, type: 'module' }));
    const tool = framework === 'vite' ? 'vite@latest' : 'next@16.3.6';
    await command('npm', ['install', '--no-audit', '--no-fund', spec, 'react@19.2.0', 'react-dom@19.2.0', tool, 'typescript@6.0.3', '@types/react@19', '@types/react-dom@19', '@types/node@24'], directory);
    const installed = JSON.parse(await readFile(join(directory, 'node_modules/@bloxwap/sfx/package.json'), 'utf8'));
    if (!archive) assert.equal(installed.version, argument, 'Installed the exact registry version');
    await command('node', ['--input-type=module', '-e', "import {play,bind,isSound} from '@bloxwap/sfx'; import {recipes} from '@bloxwap/sfx/recipes'; play('success'); bind()(); if (!isSound('success') || !recipes.success.layers.length) throw Error('SSR import failed'); console.log('SSR and recipes entry OK')"], directory);
    if (framework === 'vite') {
      await writeFile(join(directory, 'client.tsx'), client);
      await writeFile(join(directory, 'main.tsx'), "import { createRoot } from 'react-dom/client'; import { Client } from './client'; createRoot(document.getElementById('root')!).render(<Client />);");
      await writeFile(join(directory, 'index.html'), '<!doctype html><html lang="en"><title>Registry Vite smoke</title><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>');
      await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx', strict: true, noEmit: true, skipLibCheck: true }, include: ['*.tsx'] }));
      await command('npx', ['tsc', '--noEmit'], directory);
      await command('npx', ['vite', 'build'], directory);
      await serve(directory, ['vite', 'preview', '--host', '127.0.0.1', '--port', '3910', '--strictPort'], 3910);
    } else {
      await mkdir(join(directory, 'app'));
      await writeFile(join(directory, 'app/client.tsx'), client);
      await writeFile(join(directory, 'app/layout.tsx'), "import type { ReactNode } from 'react'; export default function Layout({children}:{children:ReactNode}) { return <html lang='en'><body>{children}</body></html>; }");
      await writeFile(join(directory, 'app/page.tsx'), "import { play,isSound } from '@bloxwap/sfx'; import { Client } from './client'; play('success'); export default function Page() { return <><p>SSR {isSound('success') ? 'safe' : 'failed'}</p><Client /></>; }");
      await command('npx', ['next', 'build'], directory);
      await serve(directory, ['next', 'start', '--hostname', '127.0.0.1', '--port', '3911'], 3911);
    }
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${framework === 'vite' ? 3910 : 3911}`);
      await page.getByRole('heading', { name: 'Ready' }).waitFor();
      assert.equal(await page.evaluate(() => (window as any).contexts), 0);
      await page.locator('#bound').click();
      await page.waitForFunction(() => (window as any).sfx.getOutput()?.context.state === 'running');
      const before = await page.evaluate(() => (window as any).starts);
      await page.locator('#bound').click(); await page.locator('#success').click();
      const after = await page.evaluate(() => (window as any).starts);
      assert.ok(after >= before + 3, `${framework}: bind press/release and imperative success play`);
      assert.deepEqual(errors, []);
      console.log(`${framework}: fresh install, types, production build, SSR and browser playback OK`);
      if (!archive && framework === 'vite') {
        await page.evaluate(async (version) => {
          const url = `https://esm.sh/@bloxwap/sfx@${version}`;
          const module = await import(/* @vite-ignore */ url);
          if (!module.isSound('success')) throw new Error('esm.sh import failed');
          module.play('success');
        }, argument);
        console.log('esm.sh plain-HTML import OK');
      }
    } finally { await browser.close(); }
  }
  if (!archive) {
    const response = await fetch(`https://deno.bundlejs.com/?q=${encodeURIComponent(`@bloxwap/sfx@${argument}`)}`, { signal: AbortSignal.timeout(60000) });
    assert.ok(response.ok, 'bundlejs API responds');
    const data = await response.json() as { size?: { compressedSize?: string } };
    assert.ok(data.size?.compressedSize, 'bundlejs reports compressed size');
    const match = data.size.compressedSize.match(/([\d.]+)\s*(kB|KiB|B)/i);
    assert.ok(match, 'bundlejs size has a recognized unit');
    const bytes = Number(match[1]) * (/^k/i.test(match[2]) ? 1024 : 1);
    assert.ok(bytes < 6656, `bundlejs full package stays within the 6.5 KiB budget: ${data.size.compressedSize}`);
    console.log(`bundlejs badge: ${data.size.compressedSize}`);
  } else console.log('Local archive rehearsal passed; registry/CDN/badge checks require publication.');
} finally {
  for (const child of servers) {
    if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ } }
  }
  await rm(scratch, { recursive: true, force: true });
}

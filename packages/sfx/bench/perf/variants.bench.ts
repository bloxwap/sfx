// A/B harness: identical Chromium workloads against independently built dist outputs.
// Usage: node bench/perf/variants.bench.ts base main
import { rawDir, variantPath } from './paths.ts';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { median, p95 } from './stats.ts';

const RUNS = Number(process.env.BENCH_RUNS ?? 15);
const BASE = 'http://127.0.0.1:3908';
const variants = process.argv.length > 2 ? process.argv.slice(2) : ['base'];
variants.forEach(variantPath);
if (!Number.isInteger(RUNS) || RUNS < 1) throw Error('BENCH_RUNS must be a positive integer');
const up = () => fetch(`${BASE}/bench/perf/variants.fixture.html`).then((r) => r.ok).catch(() => false);
let server;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  if (!(await up())) {
    server = spawn(process.execPath, ['test/browser/server.ts'], { cwd: new URL('../..', import.meta.url), stdio: 'ignore' });
    for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 100));
    if (!(await up())) throw Error('Browser server failed to start');
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.BENCH_CHROMIUM_EXECUTABLE, args: ['--autoplay-policy=no-user-gesture-required'] });
  const results: Record<string, Record<string, number[]>> = {};
  const push = (v: string, k: string, x: number) => ((results[v] ??= {})[k] ??= []).push(x);

  async function page(variant: string) {
    const dist = '/' + variantPath(variant);
    const p = await browser!.newPage();
    await p.goto(`${BASE}/bench/perf/variants.fixture.html?dist=${encodeURIComponent(dist)}`);
    await p.waitForFunction(() => (window as any).ready);
    await p.click('#unlock');
    await p.waitForFunction(() => (window as any).running === true);
    await p.evaluate(() => (window as any).sfx.configure({ minInterval: 0, maxVoices: 24 }));
    return p;
  }

  // Runs are interleaved across variants (run 0 of every variant, then run 1, ...) so drift hits all equally.
  for (let run = -1; run < RUNS; run++) {
    for (const v of variants) {
      const p = await page(v);
      const cdp = await p.context().newCDPSession(p);
      const r = await p.evaluate(async () => {
        const s = (window as any).sfx;
        const first: Record<string, number> = {};
        let total = 0;
        for (const n of s.sounds) { const t = performance.now(); s.play(n); const d = performance.now() - t; first[n] = d; total += d; }
        // Let the first-play renders land, then measure preload of a fresh engine.
        await s.preload(); s.stopAll(); await s.dispose();
        const t = performance.now(); await s.preload(); const preload = performance.now() - t;
        return { first, total, preload };
      });
      // dispose() closed the context; unlock again for the hot loop.
      await p.click('#unlock'); await p.waitForFunction(() => (window as any).running === true);
      await p.evaluate(async () => { const s = (window as any).sfx; await s.preload(); s.configure({ minInterval: 0, maxVoices: 24 }); });
      await cdp.send('HeapProfiler.collectGarbage');
      const before = (await cdp.send('Runtime.getHeapUsage')).usedSize;
      const plain = await p.evaluate(() => (window as any).batch(10000));
      const after = (await cdp.send('Runtime.getHeapUsage')).usedSize;
      const options = await p.evaluate(() => (window as any).batch(10000, { volume: 0.5, pan: 0.3 }));
      await p.evaluate(() => (window as any).sfx.setVolume(0.5, { category: 'controls' }));
      const category = await p.evaluate(() => (window as any).batch(10000));
      await p.close();
      if (run < 0) continue; // warmup
      push(v, 'first-play catalog total (ms)', r.total);
      for (const [n, d] of Object.entries(r.first)) push(v, `first ${n} (ms)`, d as number);
      push(v, 'preload catalog (ms)', r.preload);
      push(v, 'hot plain (µs/call)', plain);
      push(v, 'hot volume+pan (µs/call)', options);
      push(v, 'hot category 0.5 (µs/call)', category);
      push(v, 'hot plain heap growth (B/call)', (after - before) / 10000);
    }
  }
  const keys = Object.keys(results[variants[0]]);
  const lines = [`| metric | ${variants.map((v) => `${v} median | ${v} p95`).join(' | ')} |`, `| --- | ${variants.map(() => '--- | ---').join(' | ')} |`];
  for (const k of keys) lines.push(`| ${k} | ${variants.map((v) => `${median(results[v][k]).toFixed(3)} | ${p95(results[v][k]).toFixed(3)}`).join(' | ')} |`);
  console.log(`Chromium ${browser.version()} · Node ${process.version} · runs=${RUNS}\n`);
  console.log(lines.join('\n'));
  await mkdir(rawDir, { recursive: true });
  await writeFile(`${rawDir}/variants-${Date.now()}.json`, JSON.stringify({ chromium: browser.version(), node: process.version, runs: RUNS, results }, null, 2));

} finally {
  await browser?.close();
  server?.kill();
}

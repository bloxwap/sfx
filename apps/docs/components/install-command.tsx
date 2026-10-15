'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Tabs } from '@bloxwap/hig-react/navigation';

const managers = [
  { name: 'bun', command: 'bun add @bloxwap/sfx' },
  { name: 'npm', command: 'npm install @bloxwap/sfx' },
  { name: 'pnpm', command: 'pnpm add @bloxwap/sfx' },
  { name: 'yarn', command: 'yarn add @bloxwap/sfx' },
];

/** One package-manager command with its own copy result, so switching tabs never shows a stale status. */
function CommandRow({ command }: { command: string }) {
  const [result, setResult] = useState<'copied' | 'failed' | null>(null);

  useEffect(() => {
    if (result === null) return;
    const timer = window.setTimeout(() => setResult(null), result === 'copied' ? 2000 : 5000);
    return () => window.clearTimeout(timer);
  }, [result]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setResult('copied');
    } catch {
      setResult('failed');
    }
  }

  return <>
    <div className="install-command">
      <span className="install-prompt" aria-hidden="true">$</span>
      <code>{command}</code>
      <button type="button" className="hig-button" data-intent="ghost" data-shape="icon" aria-label="Copy install command" title={result === 'copied' ? 'Copied!' : 'Copy command'} onClick={copy}>
        {result === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </button>
    </div>
    <span role="status" className={result === 'failed' ? 'install-feedback' : 'hig-sr-only'}>
      {result === 'copied' ? 'Command copied to clipboard.' : result === 'failed' ? 'Could not copy. Select the command to copy it manually.' : ''}
    </span>
  </>;
}

/** HIG Tabs own the package-manager selection (roving focus, arrow/Home/End keys, tab/panel wiring). */
export function InstallCommand() {
  return <div className="package-install" data-hig-density="compact">
    <Tabs
      label="Package manager"
      defaultValue="bun"
      items={managers.map(({ name, command }) => ({ value: name, label: name, content: <CommandRow command={command} /> }))}
    />
    <p className="install-platforms">Browsers · SSR-safe · Zero dependencies</p>
  </div>;
}

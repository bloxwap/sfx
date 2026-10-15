import type { ReactNode } from 'react';
import { Callout as HIGCallout } from '@bloxwap/hig-react/status';

const severities = { info: 'info', idea: 'info', warn: 'warning', warning: 'warning', error: 'error', success: 'success' } as const;
const titles = { info: 'Note', warning: 'Important', error: 'Error', success: 'Success' } as const;

/** Fumadocs' MDX `<Callout type title>` API, rendered with the HIG callout. Static docs content is not a live region. */
export function Callout({ type = 'info', title, children }: { type?: keyof typeof severities; title?: string; children?: ReactNode }) {
  const severity = severities[type] ?? 'info';
  return <div className="docs-callout not-prose">
    <HIGCallout title={title ?? titles[severity]} severity={severity} announce={false}>{children}</HIGCallout>
  </div>;
}

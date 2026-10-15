import type { ReactNode } from 'react';
import { Callout as HIGCallout } from '@bloxwap/hig-react/status';

const severities = { info: 'info', note: 'note', idea: 'tip', warn: 'warning', warning: 'warning', error: 'error', success: 'success' } as const;
const titles = { info: 'Note', note: 'Note', tip: 'Tip', warning: 'Important', error: 'Error', success: 'Success' } as const;

/** Fumadocs' MDX `<Callout type title>` API, rendered with the HIG callout (ReactNode titles, note/tip edges). Static docs content is not a live region. */
export function Callout({ type = 'info', title, children }: { type?: keyof typeof severities; title?: ReactNode; children?: ReactNode }) {
  const severity = severities[type] ?? 'info';
  return <div className="docs-callout not-prose">
    <HIGCallout title={title ?? titles[severity]} severity={severity} announce={false}>{children}</HIGCallout>
  </div>;
}

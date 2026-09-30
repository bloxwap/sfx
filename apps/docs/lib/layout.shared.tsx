import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { assetUrl, repository } from './site';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <span className="brand">
        {/* Supplied Bloxwap artwork; the mark is never redrawn. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assetUrl('/logos/bloxwap-icon-green.svg')} alt="Bloxwap" width={28} height={28} />
        <span className="brand-product">SFX</span>
      </span>,
      url: '/',
    },
    links: [{ text: 'Docs', url: '/docs', active: 'nested-url' }],
    themeSwitch: { enabled: false },
    githubUrl: repository,
  };
}

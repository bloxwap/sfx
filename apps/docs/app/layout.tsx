import type { Metadata } from 'next';
import { BloxwapSans as sans } from '@bloxwap/font/sans';
import { BloxwapMono as mono } from '@bloxwap/font/mono';
import type { ReactNode } from 'react';
import { Provider } from '@/components/provider';
import { basePath, siteUrl } from '@/lib/site';
import { homeSocial, socialImagePath, socialMetadata } from '@/lib/social';
import './global.css';

export const metadata: Metadata = {
  metadataBase: new URL(`${siteUrl}${basePath}/`),
  title: { default: '@bloxwap/sfx — Interface sounds, synthesized live', template: '%s · @bloxwap/sfx' },
  description: 'Nineteen interaction sounds synthesized with Web Audio. No audio files, no dependencies. Guides, a live sound board and API documentation for @bloxwap/sfx.',
  icons: { icon: `${basePath}/icon.svg` },
  ...socialMetadata({ ...homeSocial, path: '/', imagePath: socialImagePath() }),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable} dark`}>
    <body className="flex min-h-screen flex-col antialiased">
      <Provider>{children}</Provider>
    </body>
  </html>;
}

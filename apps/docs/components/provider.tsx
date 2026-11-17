'use client';

import { RootProvider } from 'fumadocs-ui/provider/next';
import { useEffect, type ReactNode } from 'react';
import StaticSearch from './search';
import { SoundProvider } from '@bloxwap/sfx/react';

export function Provider({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.dataset.docsHydrated = 'true';
    return () => { delete document.documentElement.dataset.docsHydrated; };
  }, []);
  return <SoundProvider unlockOnInteraction={false}><RootProvider theme={{ forcedTheme: 'dark' }} search={{ SearchDialog: StaticSearch }}>{children}</RootProvider></SoundProvider>;
}

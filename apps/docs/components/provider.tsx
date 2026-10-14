'use client';

import { RootProvider } from 'fumadocs-ui/provider/next';
import { useEffect, type ReactNode } from 'react';
import StaticSearch from './search';

export function Provider({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.dataset.docsHydrated = 'true';
    return () => { delete document.documentElement.dataset.docsHydrated; };
  }, []);
  return <RootProvider theme={{ forcedTheme: 'dark' }} search={{ SearchDialog: StaticSearch }}>{children}</RootProvider>;
}

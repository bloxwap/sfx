import { createMDX } from 'fumadocs-mdx/next';
import type { NextConfig } from 'next';

const withMDX = createMDX();

const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
  images: { unoptimized: true },
  reactStrictMode: true,
  // Resolve both this app and the local sfx package from the workspace root.
  turbopack: { root: new URL('../..', import.meta.url).pathname },
  transpilePackages: ['@bloxwap/sfx'],
  // The type gate runs before `next build`: the build script runs `next typegen` then
  // `tsrs --noEmit -p .`, so Next's own (slower) tsc pass is redundant and skipped here.
  typescript: { ignoreBuildErrors: true },
};

export default withMDX(config);

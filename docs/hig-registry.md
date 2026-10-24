# HIG registry packages

The docs install `@bloxwap/hig-tokens`, `@bloxwap/hig-contracts`,
`@bloxwap/hig-react` and `@bloxwap/hig-og-fonts` at exact npm version `0.1.0`.
The coordinated [HIG release](https://github.com/bloxwap/hig/releases/tag/v0.1.0)
replaces the previously checked-in `e3390bbd` candidate archives.
`package-lock.json` pins each registry URL and SHA-512 integrity for `npm ci`.

The docs keep the explicit base CSS import, component CSS and existing HIG
controls. OG cards continue to use `readOgFont()` from the OG-only package;
the native font bundle is not needed. `npm run docs:check` checks all four
installed versions and registry lock entries, plus the exact approved Bold
and Black font names, weights, byte lengths and SHA-256 hashes recorded in
`apps/docs/hig-packages.json`.

The earlier candidate and font comparison evidence remains in
`evidence/hig/og-font-refresh/`. It describes that historical candidate and
does not claim registry provenance. HIG 0.1.0 was published using its
maintainer-controlled token workflow, without an npm provenance attestation.

To update, change the four exact package versions and the shared version in
`apps/docs/hig-packages.json`, regenerate the lockfile, and run a clean
`npm ci`, the repository checks, docs build/check and Chromium/WebKit docs
smokes. Update approved font hashes only when an intentional font change has
been reviewed. Reverting the registry migration restores the candidate
archives, imports and lockfile together.

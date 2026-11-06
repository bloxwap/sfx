# HIG registry package

The docs install the consolidated `@bloxwap/hig` package at exact npm version
`0.2.0`. The former `@bloxwap/hig-tokens`, `@bloxwap/hig-contracts`,
`@bloxwap/hig-react` and `@bloxwap/hig-og-fonts` packages at `0.1.0` return
404 from npm, preventing CI's frozen install. HIG 0.2.0 exposes their APIs
through subpaths of one published package.

The docs use `@bloxwap/hig/tokens`, `@bloxwap/hig/react/status` and
`@bloxwap/hig/react/navigation`, and retain the explicit tokens, base and
component CSS imports. OG cards use `readOgFont()` from
`@bloxwap/hig/og-fonts/node`; they do not load the native font entry point.

`bun.lock` pins the CI install. `package-lock.json` pins the registry URL and
SHA-512 integrity for npm audit and the HIG verifier. `npm run docs:check`
checks the exact installed version and npm lock entry, plus the approved
Bold and Black font names, weights, byte lengths and SHA-256 hashes recorded
in `apps/docs/hig-packages.json`. The font hashes are unchanged by this migration.

The earlier candidate and font comparison evidence remains in
`evidence/hig/og-font-refresh/` as historical evidence.

To update, change the exact package version and the version/release in
`apps/docs/hig-packages.json`, regenerate both lockfiles, and run
`bun install --frozen-lockfile`, the repository checks, docs build/check and
`npm audit --audit-level=high`. Update approved font hashes only when an
intentional font change has been reviewed.

# Vendored Bloxwap HIG candidate packages

`@bloxwap/hig-*` is not published to npm yet. The docs app (`apps/docs`) installs these packed
candidates through `file:` dependencies; nothing here is copied source.

| Tarball | Package | Bytes | sha256 |
| --- | --- | ---: | --- |
| `bloxwap-hig-tokens-0.1.0-candidate.sha7c67a07c.tgz` | `@bloxwap/hig-tokens` | 4,428,734 | `701750f9b85f148533995d9b603f2ea1a6acbe31ac475ac7f8ecce8cd3cd61dc` |
| `bloxwap-hig-react-0.1.0-candidate.sha7c67a07c.tgz` | `@bloxwap/hig-react` | 15,182 | `6f3d7cc721ff246c647a2479ba39e898f4ba9d2ba75177b800a9942f5dab11f9` |
| `bloxwap-hig-contracts-0.1.0-candidate.sha7c67a07c.tgz` | `@bloxwap/hig-contracts` (dependency of react) | 2,550 | `4519befc8d35c787b2f91302cf46801c82295f6dd33cbf84331be11308d71ef7` |

Source: [bloxwap/hig@7c67a07](https://github.com/bloxwap/hig/tree/7c67a07ce20c02264b0fdc57e5f27d020cfd6fdc), HIG 0.1.0 candidate.
Produced in a clean clone with:

```sh
npm ci && npm run build
npm run generate:fonts            # needs fonttools[woff]==4.61.1 and brotli==1.2.0
npm run release:dry-run -- --channel candidate
```

The dry run reported `published: false`, no tags or releases. Only the three packages used by the
docs are vendored; `hig-feedback` and `hig-native` are not needed.

What the docs use:

- `@bloxwap/hig-tokens/css`: semantic `--hig-*` palette and spacing.
- `@bloxwap/hig-react/css`: plain control recipes (`hig-button`, `hig-field`, `hig-input`, `hig-surface`, `hig-sr-only`, focus ring).
- `@bloxwap/hig-react/navigation` `Tabs` for the package-manager picker; `@bloxwap/hig-react/status` `Alert`/`Callout` for MDX callouts and the search error state.
- `@bloxwap/hig-tokens` `tokens` and `@bloxwap/hig-tokens/fonts/BloxwapSans-{Bold,Black}.ttf` for the Open Graph renderer (approved static instances of `@bloxwap/font` 0.1.2; OFL in the package).

To upgrade, rebuild tarballs from a reviewed HIG commit, replace these files, update the three
`file:` specs in `apps/docs/package.json`, run `npm install`, and update this table. Rollback is a
revert of the adopting commit (restores the previous lockfile and imports).

Known packaging note: `@bloxwap/hig-react` declares exact optional peers
`@radix-ui/react-dialog`/`react-popover` 1.1.15. They conflict with Fumadocs' `^1.1.23`, so npm
nests Fumadocs' Radix copies (re-resolved to 1.3.1 within Fumadocs' ranges). The docs do not import
HIG's Radix-backed overlay entry. See `evidence/hig/docs-package-migration/README.md`.

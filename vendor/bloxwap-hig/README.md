# Vendored Bloxwap HIG candidate packages

`@bloxwap/hig-*` is not published to npm yet. The docs app (`apps/docs`) installs these packed
candidates through `file:` dependencies; nothing here is copied source.

| Tarball | Package | Bytes | sha256 |
| --- | --- | ---: | --- |
| `bloxwap-hig-tokens-0.1.0-candidate.sha872906a9.tgz` | `@bloxwap/hig-tokens` | 8,108 | `62b4007b5e06ee571352f8a33bd7e14025745fe42234d8532092739ff49f6196` |
| `bloxwap-hig-react-0.1.0-candidate.sha872906a9.tgz` | `@bloxwap/hig-react` | 20,287 | `5835fea5e4f701815fb4152cf079901d0f8af634ef3fbb537b40fc48500670c4` |
| `bloxwap-hig-contracts-0.1.0-candidate.sha872906a9.tgz` | `@bloxwap/hig-contracts` (dependency of react) | 6,119 | `ca8d5e0fe7e6138c056e9b45182e664c69d7217295264dff56a09290acabd352` |
| `bloxwap-hig-native-fonts-0.1.0-candidate.sha872906a9.tgz` | `@bloxwap/hig-native-fonts` (build-time devDependency, OG only) | 4,420,375 | `2de088737f6f76c594e95de237342dbe4457387ed9134628ef12049266195f77` |

Source: [bloxwap/hig@872906a](https://github.com/bloxwap/hig/tree/872906a9071469af8714b3b6fb5cc7bd64d2d6f3), HIG 0.1.0 candidate.
Produced in a clean clone with:

```sh
npm ci && npm run build
npm run generate:fonts            # needs fonttools[woff]==4.61.1 and brotli
npm run release:dry-run -- --channel candidate
```

The dry run reported `published: false`, no tags or releases. Only the packages the docs use are
vendored; `hig-feedback` and `hig-native` are not needed.

What the docs use:

- `@bloxwap/hig-tokens/css`: semantic `--hig-*` palette, spacing, and the radius, motion, density and
  font roles (`styles/hig-bridge.css` maps Fumadocs/Tailwind names onto them; it declares no values).
- `@bloxwap/hig-react/css`: plain control recipes (`hig-button`, `hig-field`, `hig-input`, `hig-surface`,
  `hig-sr-only`, focus ring). They read `--hig-font-sans`/`--hig-font-mono`, which resolve to the
  `@bloxwap/font` Next loader variables, so no font bridge is needed (hig#65).
- `@bloxwap/hig-react/navigation` `Tabs` for the package-manager picker; `@bloxwap/hig-react/status`
  `Alert`/`Callout` for MDX callouts (including `note`/`tip`) and the search error state.
- `@bloxwap/hig-tokens` `tokens` for Open Graph colors, and
  `@bloxwap/hig-native-fonts/fonts/BloxwapSans-{Bold,Black}.ttf` for the Open Graph renderer (approved
  static instances of `@bloxwap/font` 0.1.2; OFL in the package). Satori cannot read the variable WOFF2 in
  `@bloxwap/font`, and the web tokens package no longer ships TTFs (hig#64). Nothing from this package is
  served by the static export.

Radix: the optional HIG peers are caret ranges since hig#63, so npm keeps one Radix tree next to Fumadocs
(34 lockfile entries, none nested). The docs still import no HIG overlay entry.

To upgrade, rebuild tarballs from a reviewed HIG commit, replace these files, update the four `file:`
specs in `apps/docs/package.json`, run `npm install`, and update this table. Rollback is a revert of
the adopting commit (restores the previous lockfile and imports).

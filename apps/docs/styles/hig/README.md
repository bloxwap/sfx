# Approved HIG plain CSS distribution

HIG 0.1.0, source commit `1a776b9326c6ba03702894943b3edbfd178c4b40` from bloxwap/hig main.

`tokens.css` is byte-for-byte `packages/tokens/generated/tokens.css`; `controls.css` is byte-for-byte `packages/react/src/styles.css`. MIT license included. The migration kit (`docs/migration/sdk-docs.md`) allows retaining Fumadocs routing/search and distinctive SDK demos. This vendored plain CSS distribution requires no unpublished package or React backend. Refresh these two files together from a reviewed HIG commit, updating this pin. `../hig-bridge.css` only translates host names and documents SDK visualization exceptions.

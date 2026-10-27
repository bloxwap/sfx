# Self-hosted CI runners

GitHub Actions jobs run on Apple Silicon Mac minis labeled
`[self-hosted, macOS, ARM64]` in runner group JWS, with exactly one permanent
exception: job `publish` in `.github/workflows/publish_npm.yml` runs on
GitHub-hosted `ubuntu-24.04`. All other jobs, including its prerequisite
`security` scan, stay on the minis.

On the minis, workflows must not call `apt`, `sudo`, `xvfb-run`, or
`playwright install --with-deps`. Inline scripts are POSIX / BSD-portable and
write scratch files under `$RUNNER_TEMP`. `actions/setup-python` cannot install
on these minis (`/Users/runner` is not writable); this repository does not need Python.

## npm trusted publishing exception

[npm trusted publishing requires GitHub-hosted runners](https://docs.npmjs.com/trusted-publishers/).
The publish job uses Node 24, pinned npm 11.6.1, `id-token: write`, and
`npm publish --provenance`, building and testing on Ubuntu itself with package-manager
caching disabled. Its `npm-release` environment must have required reviewers configured.

The org-level `NPM_TOKEN` is scoped only to authentication verification and publishing
as a transitional fallback. npm tries OIDC first, then token authentication; provenance
is attached with either method. Configure the npm Trusted Publisher for organization
`bloxwap`, repository `sfx`, workflow filename `publish_npm.yml`, and environment
`npm-release`. After verifying OIDC publishing, delete `NPM_TOKEN` and its workflow
references. Token-only registry commands still require separate credentials.

## Labels

Register each machine with the GitHub Actions runner app and keep these labels:

| Label | Why |
| --- | --- |
| `self-hosted` | Required by GitHub for non-hosted runners |
| `macOS` | OS label the workflows select on |
| `ARM64` | Apple Silicon only |

Do not add extra required labels to the workflows. Extra machine labels (for
example `macOS-15`) are fine.

## Required tools

Install these on the Mac before the runner accepts jobs. Workflows will not
`brew install` or use `sudo`.

| Tool | Used for |
| --- | --- |
| GitHub Actions runner (`actions/runner`) | Job execution. Keep it current; `actions/cache@v4` and Node 24 actions need a recent runner. |
| Xcode Command Line Tools | `git`, `curl`, `clang` / `python3` for native addons such as `node-web-audio-api` |
| bash | Default GitHub Actions shell on macOS |
| CoreAudio | Native audio backend for Chromium and WebKit. Built in; no PulseAudio required. |
| Homebrew `gnu-tar` (`gtar` on `PATH`) | `actions/upload-pages-artifact` calls `gtar` on macOS because BSD `tar` has no `--hard-dereference` |
| `gh` | GitHub CLI, preinstalled on the minis |
| `gpg` (Homebrew `gnupg`) | Preinstalled on the minis |

The Documentation **build** job looks for `gtar` and, if needed, prepends
`$(brew --prefix gnu-tar)/bin` to `PATH` when it uploads the Pages artifact
(main only; pull requests still build and `docs:check` without uploading).
It does not install the formula.

Node.js 24 and npm are installed per job by `actions/setup-node`. Playwright
browsers are installed by `npx playwright install` (no `--with-deps`) and stay
on each machine at `~/Library/Caches/ms-playwright`. Workflows do not upload
that directory with `actions/cache`.

npm reuses its configured cache directory (typically `~/.npm`). Node setup disables Actions package
manager caching with `package-manager-cache: false`, so each job avoids
archiving and transferring the persistent runner's full npm cache after its
checks finish. Do not add `cache: npm` or an `actions/cache` upload for this
directory on the Mac minis.

## Optional tools

| Tool | When |
| --- | --- |
| Homebrew | Already needed for `gnu-tar`. Not used to install packages from workflows. |
| Homebrew `pulseaudio` (`pulseaudio` and `pactl` on `PATH`) | Not required. `browser-tests` and live-docs **verify** start a PulseAudio null sink only when both binaries already exist (`command -v`). CoreAudio is the default. |

Do not install PulseAudio just to satisfy CI. Chromium and WebKit on macOS use
CoreAudio.

## Audio

Playwright covers Chromium and WebKit only. Browser jobs do not change autoplay
policy or mock Web Audio. They only make sure a real output device exists —
CoreAudio on these machines.

## Repository settings

- Allow self-hosted runners for this repository (and the `github-pages`
  environment, if environment-level runner groups are restricted). Machines are
  in runner group JWS, running as macOS user `admin`.
- OIDC stays in use for Codecov (`coverage`) and GitHub Pages (`deploy`). The
  runner must be allowed to request ID tokens for those jobs.
- Configure required reviewers for the `npm-release` environment. Merely naming
  the environment in YAML does not enable approval protection.
- Configure and verify the npm Trusted Publisher above before deleting the fallback token.
- First-time contributors to this repository need approval to run workflows
  from fork pull requests (`first_time_contributors`).

## Local rehearsal

```sh
npm ci
npm test
npm run coverage
npx playwright install chromium webkit
npm run test:browser
```

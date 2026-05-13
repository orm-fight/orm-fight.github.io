# orm-fight.github.io

Source of the public hub for the [orm-fight](https://github.com/orm-fight) experiment. Served by GitHub Pages directly from the `main` branch.

## What's here

- [`index.html`](index.html) — landing page. Renders the dependency stats table.
- [`assets/`](assets/) — `site.css`, `site.js`. No bundler, no framework.
- [`data/stats.json`](data/stats.json) — summary written by the collector.
- [`data/sbom/<repo>.json`](data/sbom/) — raw SPDX 2.3 SBOM per repo, cached from GitHub.
- [`data/trends.json`](data/trends.json) — compact rolling-window series + recent-changes feed, derived from the `stats-history` archive. Drives the sparklines and feed on the site.
- [`scripts/collect-stats.js`](scripts/collect-stats.js) — fetches SBOMs and writes the summary.
- [`scripts/write-history.js`](scripts/write-history.js) — turns `data/stats.json` + cached SBOMs into per-repo daily snapshots.
- [`scripts/build-trends.js`](scripts/build-trends.js) — reads the daily snapshots and writes `data/trends.json`.
- [`.github/workflows/collect-stats.yml`](.github/workflows/collect-stats.yml) — daily scheduled run; see [Daily history](#daily-history) below.
- `double-entry.md`, `skr03-english.pdf` — long-form persistence spec and SKR 03 reference.

## Where the data comes from

| Field                                        | Source                                                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct dependencies, name, description       | Each repo's local `package.json`                                                                                                                  |
| Total package count, licenses, ecosystems    | GitHub's dependency-graph SBOM endpoint: `GET /repos/orm-fight/<repo>/dependency-graph/sbom` (SPDX 2.3)                                           |

The SBOM endpoint is the same source GitHub uses to drive Dependabot CVE alerts, so it's the authoritative view for the supply-chain comparison the experiment is built around. Lockfile parsing was deliberately replaced with this — see `scripts/collect-stats.js` for the schema mapping.

## Refreshing

The collector expects the standard layout: every `ledger-*` repo sits next to this one inside the workspace directory.

```
node --env-file=../.env scripts/collect-stats.js
```

`GITHUB_TOKEN` is optional but raises the API rate limit from 60/hr to 5000/hr — recommended even though 10 repos fit well under the unauthenticated ceiling. Any classic PAT or fine-grained token with read access to public org metadata is enough; the SBOM endpoint is public.

Each run writes:

- `data/stats.json` — the summary the site renders.
- `data/sbom/<repo>.json` — the raw SPDX document so the page links to it and we have a local trail for diffing over time.

Per-repo status in `stats.json` is one of:

- `ok` — SBOM fetched and summarised.
- `no-sbom` — repo exists on GitHub but the dependency graph hasn't published an SBOM yet (newly pushed repo, or dependency-graph disabled in repo settings).
- `no-remote-repo` — repo isn't on the `orm-fight` org yet. Local dev only.

The script uses only Node built-ins (Node 20+ for `fetch` and `--env-file`), so this repo has no `package.json` or `node_modules` of its own — the site that reports on ORM dependency footprints should not have a dependency footprint to report on.

## Daily history

A scheduled GitHub Action ([`.github/workflows/collect-stats.yml`](.github/workflows/collect-stats.yml)) runs daily at 05:17 UTC. Each run:

1. Shallow-clones every public `ledger-*` repo in the `orm-fight` org as a sibling of this checkout.
2. Runs `scripts/collect-stats.js` to refresh `data/stats.json` + `data/sbom/<repo>.json`.
3. Runs `scripts/write-history.js` to build one self-contained snapshot per repo, copies them into a worktree checked out from the orphan `stats-history` branch, under:

   ```
   history/<repo>/<YYYY-MM-DD>.json
   ```
4. Runs `scripts/build-trends.js` against the merged archive (existing history + today's snapshot) to produce `data/trends.json` — a compact rolling-window view of total-package counts, direct-dep counts, CI conclusions, plus a feed of dep adds/bumps/removes and CI pass/fail flips.
5. Commits the refresh (`data/stats.json`, `data/sbom/`, `data/trends.json`) to `main` so the site renders the latest state.
6. Commits and pushes today's snapshot onto the `stats-history` branch.

Each snapshot includes the per-repo summary, direct deps, CI run state, and the full SPDX document at that moment — `ls history/<repo>/` reads as a timeline for that repo, and any single file is enough to reconstruct what the graph looked like on a given day.

The history branch is intentionally an orphan branch so the GitHub Pages tree on `main` stays small (~hundreds of KB) while the archive grows independently (~700 KB/day across all 10 repos, well-compressed by git's delta packing since most days only mutate a handful of versions). Only the much smaller `data/trends.json` (summaries, not raw SBOMs) lands on `main`.

To trigger a run manually (or to backfill a specific date):

```
gh workflow run collect-stats --repo orm-fight/orm-fight.github.io
gh workflow run collect-stats --repo orm-fight/orm-fight.github.io -f date=2026-05-13
```

## Local preview

```
python3 -m http.server 8000
```

Then open <http://localhost:8000>. The page fetches `data/stats.json` via `fetch()`, so opening `index.html` directly with `file://` will not work.

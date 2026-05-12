# orm-fight.github.io

Source of the public hub for the [orm-fight](https://github.com/orm-fight) experiment. Served by GitHub Pages directly from the `main` branch.

## What's here

- [`index.html`](index.html) — landing page. Renders the dependency stats table.
- [`assets/`](assets/) — `site.css`, `site.js`. No bundler, no framework.
- [`data/stats.json`](data/stats.json) — summary written by the collector.
- [`data/sbom/<repo>.json`](data/sbom/) — raw SPDX 2.3 SBOM per repo, cached from GitHub.
- [`scripts/collect-stats.js`](scripts/collect-stats.js) — fetches SBOMs and writes the summary.
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

## Local preview

```
python3 -m http.server 8000
```

Then open <http://localhost:8000>. The page fetches `data/stats.json` via `fetch()`, so opening `index.html` directly with `file://` will not work.

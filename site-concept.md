# Site concept — orm-fight.github.io

Companion to [README.md](README.md). The README explains *how* the site is built and run; this is *what it is for*. If a feature decision can't be justified against this concept, it doesn't belong on the site.

## What the site is

A long-running, publicly auditable comparison of TypeScript persistence libraries — drivers, query builders, ORMs — measured against a single fixed control: the **same minimal double-entry ledger**, implemented separately in each. The site is the *output* of that experiment; the implementations live in [orm-fight/ledger-*](https://github.com/orm-fight) repos and never see each other's code.

Most ORM comparisons argue about ergonomics. This one doesn't. It records, daily, over years, the things you can only learn by watching.

## What it measures

- **Supply-chain footprint** — how many packages each library actually pulls in, from which ecosystems, under which licenses. Sourced from GitHub's dependency-graph SBOM (the same view Dependabot uses), not from lockfile heuristics.
- **Supply-chain drift** — how often direct deps churn, how often transitive package counts move, which libraries are stable and which are noisy.
- **CI reality** — whether the same minimal test suite keeps passing on each library's idiomatic setup. A failing CI on a `ledger-*` repo is information: a library's defaults broke the thing they're supposed to make easy.

What it does **not** measure: throughput, latency, or any micro-benchmark. The control is correctness of the same 4-entry transaction example, not ops/sec. Performance comparisons at this scope are easy to fake and rarely useful.

## Audience

Three readers, in order of who the site is most useful for:

1. **Engineers picking an ORM today.** They land on the table, see direct deps vs. total-in-SBOM, scan licenses, click into one `ledger-*` repo to see what the same minimal ledger looks like under each tool. They leave with a defensible reason for their choice, not a vibe.
2. **Security and platform people** auditing what a library brings with it. The site is a cached, browsable, dated archive of every SBOM the GitHub dependency graph has published for these repos.
3. **The orm-fight maintainers** (and future-me) — to spot when a `ledger-*` repo has drifted away from the spec without anyone noticing, and to remember why a given convention exists.

## What the site shows

- **The table — now.** Per repo: category (driver / query builder / ORM), CI status, direct-dep count, transitive package count, top licenses, link to the cached SPDX. The single anchor view; everything else hangs off it.
- **Sparklines — recent past.** Per repo, a 30-day sparkline of total package count. A sudden bump or shrink is visible at a glance, even without clicking through.
- **The recent-changes feed — what moved.** Site-wide list of dep adds, bumps, removes, and CI pass/fail flips over the rolling window. Newest first, no editorial filter — the value is that you can see *all* movement.
- **The persistence spec — the control.** [`double-entry.md`](double-entry.md). Everyone implements this. The site treats it as canonical; the `ledger-*` repos treat it as a contract.
- **The reference layer — context.** [`skr03-english.pdf`](skr03-english.pdf) and the GoB/GoBD section of `double-entry.md`. Out of scope for the implementations, in scope for the doc — because they explain *why* the spec stops where it does.

## What the site deliberately is not

- **Not a benchmark.** No ops/sec, no microbenchmarks, no synthetic workload.
- **Not an opinion piece.** No winner badge. No tier list. The reader makes the call; the site shows the evidence.
- **Not a tutorial.** Each `ledger-*` repo's own README is the tutorial for that library against this spec. The hub never duplicates them.
- **Not a dependency-having site.** No `package.json`, no `node_modules`, no bundler, no framework, no Jekyll. A site that reports on dependency footprints must not have a dependency footprint to report on. Pure Node built-ins for the scripts; plain HTML / CSS / a single module script for the page.

## Design principles

- **Reproducible from scratch.** [`scripts/collect-stats.js`](scripts/collect-stats.js) + a `GITHUB_TOKEN` produces today's `data/stats.json` and `data/sbom/*.json` byte-identically (modulo timestamps) on any machine. No private state.
- **Archive on a side branch.** Daily snapshots accumulate on the orphan `stats-history` branch (~700 KB/day, well delta-compressed). `main` stays small enough for GitHub Pages to serve fast forever; the site reads only the small derived `data/trends.json` from `main`, never the raw archive.
- **Schema-versioned JSON.** Every data file carries a `schemaVersion`. The site can render old shapes on demand if we ever want a "go back in time" slider.
- **HTML is hand-written and minimal.** Anyone reading view-source should be able to understand the page. No transpilation, no framework conventions to learn.
- **Symmetry over reuse.** The `ledger-*` repos copy code rather than share it. The site does the same — readability beats DRY when the audience is humans skimming view-source, not maintainers of a large app.

## What the site grows into

In rough priority order:

- **"Compare two repos" view.** Pick two `ledger-*` repos; diff their direct deps and their transitive graphs side by side. Most real evaluations are binary choices between two contenders, not surveys of ten.
- **Per-repo detail page.** Linked from the table. Sparklines for direct-dep count, total package count, CI duration. Full license breakdown. Link to today's SBOM plus N days back from the archive.
- **CI duration tracking.** Wallclock for the same test suite under each library is a real, fair number — and a strong proxy for "how heavy is this thing to actually use."
- **`double-entry.md` rendered as a first-class page.** Today it's a raw markdown file in the repo. It should be the spec page everything else points at.
- **CVE surface.** When an ecosystem-wide CVE drops, the table highlights which `ledger-*` repos transitively depend on the vulnerable package, and on which day they first did. This is the long-term payoff the daily archive exists for.

The roadmap is intentionally short. Each item earns its way in by being something the existing data can already answer — just not yet on the page.

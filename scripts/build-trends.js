#!/usr/bin/env node
// Reads per-repo daily snapshots under <history>/history/<repo>/<YYYY-MM-DD>.json
// (the layout write-history.js produces, committed to the stats-history orphan
// branch) and writes a compact data/trends.json the site renders as sparklines
// and a "recent changes" feed.
//
// Only summarised signals land in trends.json — never the raw SBOM. The raw
// archive stays on stats-history; main remains small.
//
// Usage:
//   node scripts/build-trends.js --history <dir-containing-history/> \
//                                [--window 30] [--out data/trends.json]
//
// In CI the --history dir is the stats-history worktree set up in the
// collect-stats workflow, after today's snapshot has been copied in.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = 1;
const DEFAULT_WINDOW_DAYS = 30;
const FEED_LIMIT = 100;

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, '..');

function parseArgs(argv) {
  const args = {
    history: null,
    window: DEFAULT_WINDOW_DAYS,
    out: join(siteRoot, 'data', 'trends.json'),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--history') args.history = argv[++i];
    else if (a === '--window') args.window = Number(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
  }
  if (!args.history) {
    process.stderr.write(
      'usage: build-trends.js --history <dir-containing-history/> [--window N] [--out file]\n',
    );
    process.exit(2);
  }
  if (!Number.isFinite(args.window) || args.window < 1) {
    process.stderr.write(`invalid --window: ${args.window}\n`);
    process.exit(2);
  }
  return args;
}

function cutoffDate(windowDays) {
  // Window includes today: a window of 30 covers today and the 29 days before.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const cutoff = new Date(today.getTime() - (windowDays - 1) * 86400000);
  return cutoff.toISOString().slice(0, 10);
}

function listSnapshots(historyRoot) {
  const repoRoot = join(historyRoot, 'history');
  if (!existsSync(repoRoot)) return new Map();
  const out = new Map();
  for (const repo of readdirSync(repoRoot)) {
    const dir = join(repoRoot, repo);
    if (!statSync(dir).isDirectory()) continue;
    const files = readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    if (files.length) {
      out.set(
        repo,
        files.map((f) => ({ date: f.slice(0, 10), path: join(dir, f) })),
      );
    }
  }
  return out;
}

function loadSnapshot(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function directScopes(snap) {
  return {
    dependencies: snap?.direct?.dependencies ?? {},
    devDependencies: snap?.direct?.devDependencies ?? {},
  };
}

function diffDirect(prev, cur) {
  const out = [];
  const a = directScopes(prev);
  const b = directScopes(cur);
  for (const scope of ['dependencies', 'devDependencies']) {
    const before = a[scope];
    const after = b[scope];
    for (const name of Object.keys(after)) {
      if (!(name in before)) {
        out.push({ kind: 'dep-added', scope, name, version: after[name] });
      } else if (before[name] !== after[name]) {
        out.push({
          kind: 'dep-bumped',
          scope,
          name,
          from: before[name],
          to: after[name],
        });
      }
    }
    for (const name of Object.keys(before)) {
      if (!(name in after)) {
        out.push({ kind: 'dep-removed', scope, name, prevVersion: before[name] });
      }
    }
  }
  return out;
}

function ciFlip(prev, cur) {
  const pc = prev?.ci?.conclusion ?? null;
  const cc = cur?.ci?.conclusion ?? null;
  if (pc === cc) return null;
  // Only emit if at least one side is a terminal result. Avoids noise like
  // running→success, which is expected within a single day's snapshots.
  const terminal = new Set(['success', 'failure']);
  if (!terminal.has(pc) && !terminal.has(cc)) return null;
  return { kind: 'ci-flip', from: pc, to: cc, runUrl: cur?.ci?.htmlUrl ?? null };
}

function buildRepoTrend(snapshots, cutoff) {
  const totalPackagesSeries = [];
  const directDepCountSeries = [];
  const ciSeries = [];
  const changes = [];

  let prev = null;
  for (const entry of snapshots) {
    const snap = loadSnapshot(entry.path);
    const inWindow = snap.date >= cutoff;

    if (prev && inWindow) {
      for (const c of diffDirect(prev, snap)) {
        changes.push({ date: snap.date, ...c });
      }
      const flip = ciFlip(prev, snap);
      if (flip) changes.push({ date: snap.date, ...flip });
    }
    prev = snap;

    if (!inWindow) continue;

    totalPackagesSeries.push({
      date: snap.date,
      value: snap.sbomSummary?.totalPackages ?? null,
    });
    directDepCountSeries.push({
      date: snap.date,
      value:
        Object.keys(snap.direct?.dependencies ?? {}).length +
        Object.keys(snap.direct?.devDependencies ?? {}).length,
    });
    ciSeries.push({
      date: snap.date,
      conclusion: snap.ci?.conclusion ?? null,
      headSha: snap.ci?.headSha ?? null,
    });
  }

  return {
    totalPackagesSeries,
    directDepCountSeries,
    ciSeries,
    changes,
    lastChangeDate: changes.length ? changes[changes.length - 1].date : null,
  };
}

function main() {
  const { history, window, out } = parseArgs(process.argv.slice(2));
  const snaps = listSnapshots(history);
  const cutoff = cutoffDate(window);

  const repos = {};
  const feed = [];
  const allDates = new Set();

  for (const [repo, list] of snaps) {
    const trend = buildRepoTrend(list, cutoff);
    repos[repo] = trend;
    for (const point of trend.totalPackagesSeries) allDates.add(point.date);
    for (const c of trend.changes) feed.push({ ...c, repo });
  }

  // Newest first.
  feed.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const trends = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    windowDays: window,
    snapshotDates: [...allDates].sort(),
    repos,
    feed: feed.slice(0, FEED_LIMIT),
  };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(trends, null, 2) + '\n');

  process.stdout.write(
    `Wrote trends for ${snaps.size} repos, ${feed.length} change events (kept ${trends.feed.length}), window=${window}d cutoff=${cutoff} → ${out}\n`,
  );
}

main();

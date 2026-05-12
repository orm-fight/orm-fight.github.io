#!/usr/bin/env node
// Reads every sibling ledger-* repo's package.json for the *intended* deps,
// then fetches each repo's SBOM from the GitHub dependency-graph API for the
// *resolved* graph, and writes data/stats.json for the site to render.
//
// The SBOM endpoint is GitHub's authoritative view of what Dependabot /
// the dependency graph sees — the same source that drives CVE alerts, which
// is the whole point of this experiment.
//
// Pure Node built-ins (Node 20+ for fetch + --env-file). The
// orm-fight.github.io repo deliberately has no dependency graph of its own
// so it can't bias the stats it reports on.
//
// Usage:
//   node scripts/collect-stats.js                  # uses $GITHUB_TOKEN if set
//   node --env-file=../.env scripts/collect-stats.js
//
// A token is not strictly required for public repos but raises the rate
// limit from 60/hr to 5000/hr.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = 2;
const GH_ORG = 'orm-fight';
const GH_API = 'https://api.github.com';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, '..');
const workspaceRoot = resolve(siteRoot, '..');
const outFile = join(siteRoot, 'data', 'stats.json');
const sbomDir = join(siteRoot, 'data', 'sbom');

// Categorisation mirrors the workspace README. Anything not listed here
// is reported as "other" so a new ledger-* repo still surfaces.
const CATEGORY = {
  'ledger-sqlite3': 'driver',
  'ledger-better-sqlite3': 'driver',
  'ledger-node-sqlite': 'driver',
  'ledger-kysely': 'query-builder',
  'ledger-prisma': 'orm',
  'ledger-drizzle': 'orm',
  'ledger-sequelize': 'orm',
  'ledger-objection': 'orm',
  'ledger-typeorm': 'orm',
  'ledger-mikro-orm': 'orm',
};

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function tryReadJson(path) {
  try {
    return readJson(path);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function ghHeaders() {
  const h = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'orm-fight-stats-collector',
  };
  if (process.env.GITHUB_TOKEN) {
    h.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return h;
}

async function fetchSbom(repo) {
  const url = `${GH_API}/repos/${GH_ORG}/${repo}/dependency-graph/sbom`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (res.ok) return { status: 'ok', sbom: (await res.json()).sbom };
  if (res.status !== 404) {
    const body = await res.text();
    throw new Error(`SBOM fetch failed for ${repo}: HTTP ${res.status} ${body.slice(0, 200)}`);
  }

  // 404 is ambiguous: repo may not exist on GitHub yet, or it exists but the
  // dependency graph hasn't produced an SBOM. Disambiguate with one more call.
  const repoRes = await fetch(`${GH_API}/repos/${GH_ORG}/${repo}`, { headers: ghHeaders() });
  if (repoRes.status === 404) return { status: 'no-remote-repo' };
  return { status: 'no-sbom' };
}

function ecosystemFromPurl(purl) {
  const m = (purl ?? '').match(/^pkg:([^/]+)\//);
  return m ? m[1] : 'unknown';
}

function summariseSbom(sbom) {
  const packages = sbom.packages ?? [];
  // The first entry is typically the repo itself (no purl). Filter it out.
  const real = packages.filter((p) => (p.externalRefs ?? []).some((r) => r.referenceType === 'purl'));

  const byEcosystem = {};
  const licenses = new Map();
  const unlicensed = [];

  for (const p of real) {
    const purl = (p.externalRefs ?? []).find((r) => r.referenceType === 'purl')?.referenceLocator;
    const eco = ecosystemFromPurl(purl);
    byEcosystem[eco] = (byEcosystem[eco] ?? 0) + 1;

    const license = pickLicense(p);
    if (license) {
      licenses.set(license, (licenses.get(license) ?? 0) + 1);
    } else {
      unlicensed.push(p.name);
    }
  }

  return {
    spdxVersion: sbom.spdxVersion,
    documentName: sbom.name,
    createdAt: sbom.creationInfo?.created ?? null,
    totalPackages: real.length,
    packagesByEcosystem: byEcosystem,
    licenses: Object.fromEntries(
      [...licenses.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    ),
    unlicensedPackages: unlicensed,
  };
}

function pickLicense(pkg) {
  const candidates = [pkg.licenseConcluded, pkg.licenseDeclared];
  for (const c of candidates) {
    if (c && c !== 'NOASSERTION') return c;
  }
  return null;
}

function localRepoMeta(repoDir) {
  const name = repoDir.split('/').pop();
  const pkg = tryReadJson(join(repoDir, 'package.json'));
  if (!pkg) return null;

  return {
    name,
    category: CATEGORY[name] ?? 'other',
    description: pkg.description ?? null,
    engines: pkg.engines ?? null,
    private: pkg.private === true,
    directDependencies: pkg.dependencies ?? {},
    directDevDependencies: pkg.devDependencies ?? {},
    directDependencyCount: Object.keys(pkg.dependencies ?? {}).length,
    directDevDependencyCount: Object.keys(pkg.devDependencies ?? {}).length,
  };
}

function findLocalLedgers() {
  return readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('ledger-'))
    .map((d) => join(workspaceRoot, d.name))
    .sort();
}

async function collectRepo(repoDir) {
  const meta = localRepoMeta(repoDir);
  if (!meta) return null;

  const result = await fetchSbom(meta.name);
  if (result.status !== 'ok') {
    return { ...meta, sbomStatus: result.status, sbom: null };
  }

  writeFileSync(join(sbomDir, `${meta.name}.json`), JSON.stringify(result.sbom, null, 2) + '\n');
  return { ...meta, sbomStatus: 'ok', sbom: summariseSbom(result.sbom) };
}

async function main() {
  mkdirSync(dirname(outFile), { recursive: true });
  mkdirSync(sbomDir, { recursive: true });

  const ledgers = findLocalLedgers();
  process.stdout.write(`Collecting ${ledgers.length} ledger-* repos…\n`);
  if (!process.env.GITHUB_TOKEN) {
    process.stdout.write('  (no GITHUB_TOKEN set — using unauthenticated 60/hr rate limit)\n');
  }

  const repos = [];
  for (const dir of ledgers) {
    const r = await collectRepo(dir);
    if (r) repos.push(r);
  }

  const stats = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: 'github-dependency-graph-sbom',
    workspace: GH_ORG,
    repoCount: repos.length,
    repos,
  };

  writeFileSync(outFile, JSON.stringify(stats, null, 2) + '\n');

  process.stdout.write(`\nWrote ${repos.length} repos to ${outFile}\n`);
  const statusLabel = {
    ok: '',
    'no-sbom': '(repo exists, no SBOM yet)',
    'no-remote-repo': '(no GitHub remote yet)',
  };
  for (const r of repos) {
    if (r.sbomStatus === 'ok') {
      const npm = r.sbom.packagesByEcosystem.npm ?? 0;
      const total = r.sbom.totalPackages;
      process.stdout.write(
        `  ${r.name.padEnd(26)} direct=${r.directDependencyCount} npm=${npm} total=${total}\n`,
      );
    } else {
      process.stdout.write(
        `  ${r.name.padEnd(26)} direct=${r.directDependencyCount} ${statusLabel[r.sbomStatus] ?? r.sbomStatus}\n`,
      );
    }
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack ?? err}\n`);
  process.exit(1);
});

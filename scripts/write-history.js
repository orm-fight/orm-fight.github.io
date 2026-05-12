#!/usr/bin/env node
// Reads data/stats.json + data/sbom/<repo>.json, then writes one daily
// snapshot file per repo at <out>/history/<repo>/<YYYY-MM-DD>.json.
//
// Designed to run after scripts/collect-stats.js inside the daily
// collect-stats workflow. Each snapshot is self-contained — per-repo
// summary + full SPDX SBOM — so a single file fully describes one repo
// on one day. Filenames sort by date; `ls history/<repo>/` gives the
// timeline.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, '..');

function parseArgs(argv) {
  const args = { out: null, date: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--date') args.date = argv[++i];
  }
  if (!args.out) {
    process.stderr.write('usage: write-history.js --out <dir> [--date YYYY-MM-DD]\n');
    process.exit(2);
  }
  args.date ??= new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    process.stderr.write(`invalid --date: ${args.date}\n`);
    process.exit(2);
  }
  return args;
}

function main() {
  const { out, date } = parseArgs(process.argv.slice(2));

  const stats = JSON.parse(readFileSync(join(siteRoot, 'data', 'stats.json'), 'utf8'));

  let written = 0;
  for (const repo of stats.repos) {
    const sbomPath = join(siteRoot, 'data', 'sbom', `${repo.name}.json`);
    const sbom = existsSync(sbomPath) ? JSON.parse(readFileSync(sbomPath, 'utf8')) : null;

    const snapshot = {
      repo: repo.name,
      date,
      generatedAt: stats.generatedAt,
      schemaVersion: stats.schemaVersion,
      source: stats.source,
      category: repo.category,
      description: repo.description,
      engines: repo.engines,
      direct: {
        dependencies: repo.directDependencies,
        devDependencies: repo.directDevDependencies,
      },
      ci: repo.ci ?? null,
      sbomStatus: repo.sbomStatus,
      sbomSummary: repo.sbom,
      sbom,
    };

    const outPath = join(out, 'history', repo.name, `${date}.json`);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n');
    written++;
  }

  process.stdout.write(`Wrote ${written} snapshots dated ${date} under ${out}/history\n`);
}

main();

const CATEGORY_ORDER = ['driver', 'query-builder', 'orm', 'other'];
const CATEGORY_LABEL = {
  driver: 'Driver',
  'query-builder': 'Query builder',
  orm: 'ORM',
  other: 'Other',
};

const STATUS_LABEL = {
  ok: '',
  'no-sbom': 'pending',
  'no-remote-repo': 'no remote yet',
};

const CI_BADGE = {
  success: { label: 'pass', cls: 'pass' },
  failure: { label: 'fail', cls: 'fail' },
  cancelled: { label: 'cancelled', cls: 'cancelled' },
  skipped: { label: 'skipped', cls: 'skipped' },
  null: { label: 'running', cls: 'running' },
};

const REPO_URL = (name) => `https://github.com/orm-fight/${name}`;

async function loadJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) {
    const err = new Error(`${path}: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function loadStats() {
  return loadJson('data/stats.json');
}

async function loadTrendsOptional() {
  try {
    return await loadJson('data/trends.json');
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

function fmt(n) {
  return n == null ? '—' : Number(n).toLocaleString('en-US');
}

function ciCell(ci) {
  if (!ci || ci.status !== 'ok') {
    return '<span class="ci-badge muted">—</span>';
  }
  const key = ci.runStatus === 'completed' ? ci.conclusion : null;
  const { label, cls } = CI_BADGE[key] ?? { label: ci.runStatus, cls: 'unknown' };
  const sha = ci.headSha ? ci.headSha.slice(0, 7) : '';
  const title = `${ci.workflowName} #${ci.runNumber} on ${sha}\n${ci.commitTitle ?? ''}`;
  return `<a href="${ci.htmlUrl}" class="ci-badge ${cls}" title="${title.replace(/"/g, '&quot;')}">${label}</a>`;
}

function topLicenses(licenses, limit = 3) {
  const entries = Object.entries(licenses ?? {});
  if (entries.length === 0) return '—';
  const shown = entries.slice(0, limit).map(([lic, n]) => `${lic} (${n})`);
  const rest = entries.length - shown.length;
  return rest > 0 ? `${shown.join(', ')}, +${rest} more` : shown.join(', ');
}

// Tiny inline SVG. We deliberately don't use a charting lib — the page has no
// build step and the data is tiny (≤ window days of integer points per repo).
function sparkline(series, opts = {}) {
  const width = opts.width ?? 80;
  const height = opts.height ?? 18;
  const pad = 1.5;
  const points = (series ?? []).filter((p) => p.value != null);
  if (points.length < 2) return '<span class="sparkline-empty" title="not enough history yet">—</span>';

  const xs = points.map((_, i) => i);
  const ys = points.map((p) => p.value);
  const xMin = 0;
  const xMax = xs.length - 1;
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const yRange = yMax - yMin || 1;

  const sx = (i) => pad + ((width - 2 * pad) * (i - xMin)) / (xMax - xMin || 1);
  const sy = (v) => height - pad - ((height - 2 * pad) * (v - yMin)) / yRange;

  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(2)},${sy(p.value).toFixed(2)}`)
    .join(' ');

  const last = points[points.length - 1];
  const first = points[0];
  const changed = last.value !== first.value;
  const cls = changed ? 'sparkline changed' : 'sparkline flat';
  const title = `${first.date}: ${first.value} → ${last.date}: ${last.value}`;

  return `<svg class="${cls}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="trend ${title}"><title>${title}</title><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${sx(xs.length - 1).toFixed(2)}" cy="${sy(last.value).toFixed(2)}" r="1.6" fill="currentColor"/></svg>`;
}

function renderTable(stats, trends) {
  const sorted = [...stats.repos].sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category);
    const cb = CATEGORY_ORDER.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    return a.name.localeCompare(b.name);
  });

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Repo</th>
        <th>Category</th>
        <th>CI</th>
        <th class="num">Direct deps</th>
        <th class="num">npm</th>
        <th class="num">Total in SBOM</th>
        <th>Trend</th>
        <th>Top licenses</th>
        <th>SBOM</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector('tbody');
  for (const r of sorted) {
    const s = r.sbom;
    const tr = document.createElement('tr');
    tr.dataset.status = r.sbomStatus;

    const repoCell =
      r.sbomStatus === 'no-remote-repo'
        ? `<code>${r.name}</code>`
        : `<a href="${REPO_URL(r.name)}"><code>${r.name}</code></a>`;
    const categoryCell = `<span class="category">${CATEGORY_LABEL[r.category] ?? r.category}</span>`;
    const directCell = fmt(r.directDependencyCount + r.directDevDependencyCount);
    const trend = trends?.repos?.[r.name];
    const sparkCell = trend
      ? sparkline(trend.totalPackagesSeries)
      : '<span class="sparkline-empty" title="no trend data yet">—</span>';

    if (r.sbomStatus === 'ok') {
      tr.innerHTML = `
        <td>${repoCell}</td>
        <td>${categoryCell}</td>
        <td>${ciCell(r.ci)}</td>
        <td class="num">${directCell}</td>
        <td class="num">${fmt(s.packagesByEcosystem.npm)}</td>
        <td class="num">${fmt(s.totalPackages)}</td>
        <td class="sparkline-cell">${sparkCell}</td>
        <td class="license-list">${topLicenses(s.licenses)}</td>
        <td class="sbom-link"><a href="data/sbom/${r.name}.json" title="Cached SPDX JSON from GitHub dependency-graph API">SPDX</a></td>
      `;
    } else {
      tr.innerHTML = `
        <td>${repoCell}</td>
        <td>${categoryCell}</td>
        <td>${ciCell(r.ci)}</td>
        <td class="num">${directCell}</td>
        <td class="num muted" colspan="5">${STATUS_LABEL[r.sbomStatus] ?? r.sbomStatus}</td>
      `;
    }
    tbody.appendChild(tr);
  }

  return table;
}

function changeDescription(c) {
  switch (c.kind) {
    case 'dep-added':
      return `<span class="change-verb added">added</span> <code>${c.name}</code>@<code>${c.version}</code> <span class="scope">(${c.scope})</span>`;
    case 'dep-removed':
      return `<span class="change-verb removed">removed</span> <code>${c.name}</code> <span class="scope">(was <code>${c.prevVersion}</code>, ${c.scope})</span>`;
    case 'dep-bumped':
      return `<span class="change-verb bumped">bumped</span> <code>${c.name}</code> <code>${c.from}</code> → <code>${c.to}</code> <span class="scope">(${c.scope})</span>`;
    case 'ci-flip': {
      const label = (k) => CI_BADGE[k]?.label ?? k ?? '—';
      const cls = (k) => CI_BADGE[k]?.cls ?? 'unknown';
      const run = c.runUrl
        ? ` <a class="run-link" href="${c.runUrl}">run</a>`
        : '';
      return `<span class="change-verb ci">CI</span> <span class="ci-badge ${cls(c.from)}">${label(c.from)}</span> → <span class="ci-badge ${cls(c.to)}">${label(c.to)}</span>${run}`;
    }
    default:
      return `<span class="change-verb">${c.kind}</span>`;
  }
}

function renderFeed(trends) {
  const host = document.getElementById('changes-feed');
  if (!trends) {
    host.replaceChildren(emptyMessage('Daily history hasn\'t produced trend data yet. Check back after the next scheduled run.'));
    host.removeAttribute('aria-busy');
    return;
  }
  if (!trends.feed.length) {
    host.replaceChildren(emptyMessage(`No dependency or CI changes in the last ${trends.windowDays} days.`));
    host.removeAttribute('aria-busy');
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'feed';
  for (const c of trends.feed) {
    const li = document.createElement('li');
    li.innerHTML = `
      <time datetime="${c.date}">${c.date}</time>
      <a class="feed-repo" href="${REPO_URL(c.repo)}"><code>${c.repo}</code></a>
      ${changeDescription(c)}
    `;
    ul.appendChild(li);
  }
  host.replaceChildren(ul);
  host.removeAttribute('aria-busy');
}

function emptyMessage(text) {
  const p = document.createElement('p');
  p.className = 'meta empty';
  p.textContent = text;
  return p;
}

function renderError(err) {
  const div = document.createElement('div');
  div.textContent = `Failed to load stats: ${err.message}`;
  div.style.color = 'crimson';
  return div;
}

async function main() {
  const host = document.getElementById('stats-table');
  const feedHost = document.getElementById('changes-feed');
  const generatedAt = document.getElementById('generated-at');

  try {
    const [stats, trends] = await Promise.all([loadStats(), loadTrendsOptional()]);

    if (trends) {
      document.getElementById('trend-window').textContent = String(trends.windowDays);
      document.getElementById('feed-window').textContent = String(trends.windowDays);
    }

    host.replaceChildren(renderTable(stats, trends));
    host.removeAttribute('aria-busy');
    renderFeed(trends);

    const ts = new Date(stats.generatedAt);
    generatedAt.dateTime = stats.generatedAt;
    generatedAt.textContent = ts.toUTCString();
  } catch (err) {
    host.replaceChildren(renderError(err));
    host.removeAttribute('aria-busy');
    feedHost.replaceChildren(renderError(err));
    feedHost.removeAttribute('aria-busy');
  }
}

main();

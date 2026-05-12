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

const REPO_URL = (name) => `https://github.com/orm-fight/${name}`;

async function loadStats() {
  const res = await fetch('data/stats.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`stats.json: ${res.status}`);
  return res.json();
}

function fmt(n) {
  return n == null ? '—' : Number(n).toLocaleString('en-US');
}

function topLicenses(licenses, limit = 3) {
  const entries = Object.entries(licenses ?? {});
  if (entries.length === 0) return '—';
  const shown = entries.slice(0, limit).map(([lic, n]) => `${lic} (${n})`);
  const rest = entries.length - shown.length;
  return rest > 0 ? `${shown.join(', ')}, +${rest} more` : shown.join(', ');
}

function renderTable(stats) {
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
        <th class="num">Direct deps</th>
        <th class="num">npm</th>
        <th class="num">Total in SBOM</th>
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

    if (r.sbomStatus === 'ok') {
      tr.innerHTML = `
        <td><a href="${REPO_URL(r.name)}"><code>${r.name}</code></a></td>
        <td><span class="category">${CATEGORY_LABEL[r.category] ?? r.category}</span></td>
        <td class="num">${fmt(r.directDependencyCount + r.directDevDependencyCount)}</td>
        <td class="num">${fmt(s.packagesByEcosystem.npm)}</td>
        <td class="num">${fmt(s.totalPackages)}</td>
        <td class="license-list">${topLicenses(s.licenses)}</td>
        <td class="sbom-link"><a href="data/sbom/${r.name}.json" title="Cached SPDX JSON from GitHub dependency-graph API">SPDX</a></td>
      `;
    } else {
      tr.innerHTML = `
        <td><code>${r.name}</code></td>
        <td><span class="category">${CATEGORY_LABEL[r.category] ?? r.category}</span></td>
        <td class="num">${fmt(r.directDependencyCount + r.directDevDependencyCount)}</td>
        <td class="num muted" colspan="4">${STATUS_LABEL[r.sbomStatus] ?? r.sbomStatus}</td>
      `;
    }
    tbody.appendChild(tr);
  }

  return table;
}

function renderError(err) {
  const div = document.createElement('div');
  div.textContent = `Failed to load stats: ${err.message}`;
  div.style.color = 'crimson';
  return div;
}

async function main() {
  const host = document.getElementById('stats-table');
  const generatedAt = document.getElementById('generated-at');

  try {
    const stats = await loadStats();
    host.replaceChildren(renderTable(stats));
    host.removeAttribute('aria-busy');

    const ts = new Date(stats.generatedAt);
    generatedAt.dateTime = stats.generatedAt;
    generatedAt.textContent = ts.toUTCString();
  } catch (err) {
    host.replaceChildren(renderError(err));
    host.removeAttribute('aria-busy');
  }
}

main();

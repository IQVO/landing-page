// Renders the engineering study (data/engineering.json) into static pages under dist/engineering/.
//   /engineering/                    overview: fleet KPIs, months, weeks, every project by month, method
//   /engineering/weeks/              index of the weekly reports
//   /engineering/weeks/<YYYY-Www>/   one software-engineering report per ISO week
//   /engineering/projects/<repo>/    one study per project
// No JavaScript: charts are inline SVG whose geometry lives in attributes (the strict CSP forbids style="").
// Every number is read from data/engineering.json; every sentence that states a number is computed here.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('en-US');
const n = (x) => (x == null ? '—' : nf.format(x));
const pct = (x) => (x == null ? '—' : `${x.toFixed(x >= 99.95 || x === Math.round(x) ? 0 : 1)}%`);
const hrs = (h) => {
  if (h == null) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `${(h / 24).toFixed(1)} d`;
};
const dShort = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dLong = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const sum = (arr) => arr.reduce((a, b) => a + (b || 0), 0);
const median = (arr) => { const s = arr.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const lines = (o, keys) => sum(keys.map((k) => o?.[k]));
const plural = (x, one, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;
const weekNo = (id) => Number(id.split('-W')[1]);
const rangeLabel = (w) => {
  const s = new Date(`${w.start}T00:00:00Z`), e = new Date(`${w.end}T00:00:00Z`);
  const sameMonth = s.getUTCMonth() === e.getUTCMonth();
  return sameMonth ? `${s.getUTCDate()}–${dLong(w.end)}` : `${dShort(w.start)} – ${dLong(w.end)}`;
};
const delta = (cur, prev, { unit = '', lowerIsBetter = false, fmt = (x) => x } = {}) => {
  if (cur == null || prev == null) return '<span class="dl dl--na">no comparison</span>';
  const d = cur - prev;
  if (Math.abs(d) < 1e-9) return '<span class="dl dl--flat">= previous week</span>';
  const good = lowerIsBetter ? d < 0 : d > 0;
  return `<span class="dl ${good ? 'dl--good' : 'dl--bad'}">${d > 0 ? '▲' : '▼'} ${esc(fmt(Math.abs(d)))}${unit} vs previous week</span>`;
};
const rateCls = (x, good = 90, warn = 75) => (x == null ? 'na' : x >= good ? 'good' : x >= warn ? 'warn' : 'bad');
const CODE_KEYS = ['code'];
const TEST_KEYS = ['test'];

export function renderEngineering({ data, cfg, updatedLabel }) {
  const D = data;
  const repos = Object.values(D.repos);
  const groups = D.groups.map((g) => ({ ...g, repos: repos.filter((r) => r.group === g.id) })).filter((g) => g.repos.length);
  const groupLabel = Object.fromEntries(D.groups.map((g) => [g.id, g.label]));
  const weeks = D.weeks; const months = D.months;
  const complete = weeks.filter((w) => !w.partial);
  const latest = weeks[weeks.length - 1];
  const gh = (r) => (r.private ? null : `${cfg.githubUrl}/${r.name}`);
  const pages = [];

  // ------------------------------------------------------------ layout
  const NAV = [
    ['/engineering/', 'Overview', 'overview'],
    ['/engineering/#projects', 'Projects', 'projects'],
    ['/engineering/weeks/', 'Weekly reports', 'weeks'],
    ['/engineering/#method', 'Method', 'method'],
  ];
  const layout = ({ path, title, description, current, body }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · IQVO engineering study</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#0B1D2D">
<meta name="color-scheme" content="light">
${cfg.siteUrl ? `<link rel="canonical" href="${cfg.siteUrl}${path}">\n` : ''}<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/assets/fonts/bricolage-grotesque.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/main.css">
<link rel="stylesheet" href="/assets/css/eng.css">
</head>
<body class="eng">
<a class="skip" href="#main">Skip to content</a>
<div class="sticky">
<p class="banner" role="note">
  <strong>A study project.</strong>
  <span>Not a product, not production, not affiliated with any company.</span>
</p>
<header class="enav" id="top">
  <div class="wrap enav__in">
    <a class="brand" href="/" aria-label="IQVO Warehouse Systems, landing page">
      <img src="/assets/img/iqvo-logo.png" width="130" height="46" alt="IQVO Warehouse Systems">
    </a>
    <nav class="enav__nav" aria-label="Engineering study">
      <ul class="enav__links">
${NAV.map(([href, label, id]) => `        <li><a href="${href}"${id === current ? ' aria-current="page"' : ''}>${label}</a></li>`).join('\n')}
      </ul>
    </nav>
  </div>
</header>
</div>
<main id="main">
${body}
</main>
<footer class="foot">
  <div class="wrap foot__grid">
    <div class="foot__brand">
      <img src="/assets/img/iqvo-logo.png" width="119" height="42" alt="IQVO Warehouse Systems" loading="lazy">
      <p class="foot__tag">Inventory + Queue + Value + Orchestration. A study of Domain-Driven Design with AI agents.</p>
    </div>
    <div class="foot__disc">
      <h2 class="mono foot__h">Disclaimer</h2>
      <p>This project is a domain-driven design study. It is not associated with, endorsed by or affiliated with any company, and it uses no company&rsquo;s code, data, logos or trademarks. All names, figures and examples are illustrative or synthetic.</p>
    </div>
    <div class="foot__made">
      <h2 class="mono foot__h">How this study was made</h2>
      <p>Counted from git and the GitHub API by <code>scripts/collect-engineering.mjs</code> on ${esc(updatedLabel)} and rendered by <code>scripts/engineering.mjs</code>; no number is typed by hand. Written by Claude Opus 5.5 under human direction. The metrics are proxies, explained in the <a href="/engineering/#method">method</a>.</p>
    </div>
  </div>
  <div class="wrap foot__base mono">
    <span>MIT licence</span>
    <a href="/">Landing page</a>
    <a href="${cfg.githubUrl}" rel="noopener">GitHub</a>
    <a href="${cfg.docsUrl}/" rel="noopener">Documentation</a>
    <a href="#top">Back to top ↑</a>
  </div>
</footer>
</body>
</html>
`;
  const page = (p) => pages.push({ file: `${p.path.replace(/^\//, '')}index.html`, html: layout(p) });

  // ------------------------------------------------------------ building blocks
  const kpis = (items) => `<dl class="kpis">${items.map(([label, value, note]) => `<div class="kpi"><dt>${label}</dt><dd>${value}</dd>${note ? `<p class="kpi__note">${note}</p>` : ''}</div>`).join('')}</dl>`;
  const tableWrap = (label, inner) => `<div class="tw" role="region" aria-label="${esc(label)}" tabindex="0">${inner}</div>`;
  const crumbs = (items) => `<nav class="crumbs mono" aria-label="Breadcrumb"><ol>${items.map(([href, label], i) => `<li>${i === items.length - 1 ? `<span aria-current="page">${esc(label)}</span>` : `<a href="${href}">${esc(label)}</a>`}</li>`).join('')}</ol></nav>`;

  // grouped/stacked bar chart; values per label per series. role=img + summary; every bar carries a <title>.
  function bars({ labels, series, label, height = 180, stacked = false, unit = '' }) {
    const W = 720, H = height, padL = 34, padB = 24, padT = 10;
    const nL = labels.length; const nS = series.length;
    const totals = labels.map((_, i) => (stacked ? sum(series.map((s) => s.values[i])) : Math.max(...series.map((s) => s.values[i] || 0))));
    const max = Math.max(1, ...totals);
    const slot = (W - padL) / nL; const gap = Math.min(10, slot * 0.25);
    const bw = stacked ? slot - gap : (slot - gap) / nS;
    const y = (v) => (H - padB) - ((H - padB - padT) * v) / max;
    let out = '';
    // gridlines at 0, 50%, 100%
    for (const f of [0, 0.5, 1]) {
      const v = max * f; const yy = y(v).toFixed(1);
      out += `<line class="ch__grid" x1="${padL}" x2="${W}" y1="${yy}" y2="${yy}"/><text class="ch__ax" x="${padL - 6}" y="${(+yy + 3.5).toFixed(1)}" text-anchor="end">${esc(n(Math.round(v)))}</text>`;
    }
    labels.forEach((lab, i) => {
      let acc = 0;
      series.forEach((s, k) => {
        const v = s.values[i] || 0;
        const x = padL + i * slot + gap / 2 + (stacked ? 0 : k * bw);
        const top = stacked ? y(acc + v) : y(v); const bottom = stacked ? y(acc) : y(0);
        const h = Math.max(0, bottom - top);
        if (v > 0) out += `<rect class="ch__b ch__b--${s.cls}" x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(1, bw - (stacked ? 0 : 1)).toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}"><title>${esc(lab)}: ${esc(n(v))}${unit} ${esc(s.name)}</title></rect>`;
        acc += v;
      });
      const every = Math.ceil(nL / 14);
      if (i % every === 0 || i === nL - 1) out += `<text class="ch__ax" x="${(padL + i * slot + slot / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle">${esc(lab)}</text>`;
    });
    const legend = series.map((s) => `<li><span class="sw sw--${s.cls}" aria-hidden="true"></span>${esc(s.name)}</li>`).join('');
    return `<figure class="chart"><svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${out}</svg><figcaption><ul class="legend mono">${legend}</ul></figcaption></figure>`;
  }
  // tiny weekly sparkline (commits)
  function spark(values, label) {
    const W = 120, H = 28; const max = Math.max(1, ...values); const bw = W / values.length;
    const rects = values.map((v, i) => (v ? `<rect x="${(i * bw + 0.5).toFixed(1)}" y="${(H - (H - 2) * v / max).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${((H - 2) * v / max).toFixed(1)}"/>` : '')).join('');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${rects}</svg>`;
  }
  // a horizontal stacked bar of line classes (tracked lines at HEAD)
  function classBar(obj, label) {
    const keys = D.classes.filter((k) => obj[k] > 0); const total = sum(keys.map((k) => obj[k]));
    if (!total) return '<p class="muted">No tracked text lines.</p>';
    let x = 0; const W = 720;
    const rects = keys.map((k) => { const w = (W * obj[k]) / total; const r = `<rect class="cl cl--${k}" x="${x.toFixed(1)}" y="0" width="${Math.max(w, 0.5).toFixed(1)}" height="22"><title>${k}: ${n(obj[k])} lines (${pct((100 * obj[k]) / total)})</title></rect>`; x += w; return r; }).join('');
    const legend = keys.map((k) => `<li><span class="sw cl--${k}" aria-hidden="true"></span>${k} <b>${n(obj[k])}</b> <span class="muted">(${pct((100 * obj[k]) / total)})</span></li>`).join('');
    return `<figure class="chart"><svg class="ch ch--bar" viewBox="0 0 ${W} 22" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">${rects}</svg><figcaption><ul class="legend mono">${legend}</ul></figcaption></figure>`;
  }
  const heat = (v, max) => (v ? `hm${Math.min(5, Math.max(1, Math.ceil(5 * Math.sqrt(v / Math.max(1, max)))))}` : 'hm0');
  const scoreBadge = (s) => `<span class="score score--${rateCls(s, 80, 60)}">${s == null ? '—' : s}</span>`;
  const monthHead = (m) => `${esc(m.label.split(' ')[0].slice(0, 3))}${m.partial || m.startsMidMonth ? '*' : ''}`;

  const SIGNALS = [
    ['ci', 'CI success', 'decided Actions runs that passed', '100%'],
    ['stability', 'Branch stability', 'pushes to develop/main whose CI stayed green', '100%'],
    ['flow', 'Changes through PRs', 'first-parent changes on the default branch that arrived via a pull request', '100%'],
    ['batch', 'Small batches', 'merged non-bot PRs with at most 400 changed lines', '100%'],
    ['tests', 'Test investment', 'test lines per code line at HEAD, scored against 0.8', '≥ 0.8'],
    ['hygiene', 'Commit hygiene', 'non-bot commit subjects in Conventional Commits form', '100%'],
    ['harness', 'Harness coverage', 'share of the 16-item harness checklist present at HEAD', '16 / 16'],
  ];
  const HARNESS = [
    ['makefile', 'Makefile entry points'], ['lefthook', 'lefthook git hooks'], ['linter', 'Linter config (golangci / eslint)'], ['ci', 'GitHub Actions CI'],
    ['codeql', 'CodeQL scanning'], ['scorecard', 'OpenSSF Scorecard'], ['dependabot', 'Dependabot config'], ['bdd', 'BDD feature files'],
    ['mutation', 'Mutation testing (gremlins / stryker)'], ['apiLint', 'API lint (Spectral)'], ['contract', 'OpenAPI / AsyncAPI contract'], ['adr', 'Architecture Decision Records'],
    ['agents', 'AGENTS.md agent rules'], ['dockerfile', 'Dockerfile'], ['security', 'SECURITY.md'],
  ];
  // the checklist length is whatever the collector measured
  const harnessLen = Object.keys(repos[0].harness).length;
  SIGNALS[6][2] = `share of the ${harnessLen}-item harness checklist present at HEAD`; SIGNALS[6][3] = `${harnessLen} / ${harnessLen}`;
  const HARNESS_LABEL = Object.fromEntries(HARNESS);

  // ------------------------------------------------------------ fleet medians for comparisons
  const fleetMedian = (key) => median(repos.map((r) => r.score[key]));
  const fleetScoreMedian = fleetMedian('total');

  // ============================================================ OVERVIEW
  {
    const T = D.total; const om = D.orgMonths; const ow = D.orgWeeks;
    const lastWeeks = weeks.slice(-5, -1).map((w) => ow[w.id] || {});
    const monthRows = months.map((m) => { const x = om[m.id] || {}; return `<tr><th scope="row">${esc(m.label)}${m.partial ? ' <span class="tag">to date</span>' : ''}${m.startsMidMonth ? ' <span class="tag">from first commit</span>' : ''}</th>
<td>${n(x.commits)}</td><td>${n(x.prOpened)}</td><td>${n(x.prMerged)}</td><td>${hrs(x.leadMedianH)}</td><td>${n(x.runs)}</td><td class="r-${rateCls(x.successRate)}">${pct(x.successRate)}</td><td>${pct(x.changeFailRate)}</td><td>${hrs(x.restoreMedianH)}</td><td>${n(x.releases)}</td><td>${n(x.activeRepos)}</td></tr>`; }).join('');
    const weekRows = [...weeks].reverse().map((w) => { const x = ow[w.id] || {}; return `<tr><th scope="row"><a href="/engineering/weeks/${w.id}/">Week ${weekNo(w.id)}</a>${w.partial ? ' <span class="tag">in progress</span>' : ''}</th><td>${esc(rangeLabel(w))}</td><td>${n(x.commits)}</td><td>${n(x.prMerged)}</td><td class="r-${rateCls(x.successRate)}">${pct(x.successRate)}</td><td>${hrs(x.leadMedianH)}</td><td>${pct(x.changeFailRate)}</td><td>${n(x.releases)}</td></tr>`; }).join('');

    const matrix = (key, title) => {
      const max = Math.max(1, ...repos.flatMap((r) => months.map((m) => r.months[m.id]?.[key] || 0)));
      return groups.map((g) => `<tr class="grp"><th scope="colgroup" colspan="${months.length + 5}">${esc(g.label)} <span class="muted">· ${plural(g.repos.length, 'project')}</span></th></tr>` +
        g.repos.map((r) => `<tr><th scope="row"><a href="/engineering/projects/${r.name}/">${esc(r.name)}</a></th>${months.map((m) => { const v = r.months[m.id]?.[key] || 0; return `<td class="hc ${heat(v, max)}">${v ? n(v) : '<span aria-hidden="true">·</span><span class="sr">0</span>'}</td>`; }).join('')}<td class="num"><b>${n(r.total[key])}</b></td><td>${scoreBadge(r.score.total)}</td><td class="r-${rateCls(r.score.ci)}">${r.score.ci == null ? '—' : `${r.score.ci}%`}</td><td>${spark(weeks.map((w) => r.weeks[w.id]?.[key] || 0), `${r.name}: ${title} per week`)}</td></tr>`).join('')).join('');
    };
    const matrixTable = (key, title, id) => tableWrap(`${title} per project per month`, `<table class="t t--matrix" id="${id}"><caption>${esc(title)} per project per month <span class="muted">(* partial month)</span></caption>
<thead><tr><th scope="col">Project</th>${months.map((m) => `<th scope="col">${monthHead(m)}</th>`).join('')}<th scope="col">Total</th><th scope="col">Score</th><th scope="col">CI 4w</th><th scope="col">Per week</th></tr></thead><tbody>${matrix(key, title)}</tbody></table>`);

    const ranked = [...repos].filter((r) => r.score.total != null).sort((a, b) => b.score.total - a.score.total);
    const scoreRows = ranked.map((r, i) => `<tr><td class="num">${i + 1}</td><th scope="row"><a href="/engineering/projects/${r.name}/">${esc(r.name)}</a></th><td>${esc(groupLabel[r.group])}</td><td>${scoreBadge(r.score.total)}</td>${SIGNALS.map(([k]) => `<td class="r-${rateCls(r.score[k], 80, 60)}">${r.score[k] == null ? '—' : r.score[k]}</td>`).join('')}</tr>`).join('');

    const lw = ow[latest.id] || {};
    const body = `
<section class="ehero">
  <div class="wrap ehero__grid">
   <div>
    <p class="kicker">Engineering study · counted ${esc(updatedLabel)}</p>
    <h1>How the IQVO fleet is <em>engineered,</em> week by week.</h1>
    <p class="lede">${plural(D.scope.repos, 'repository', 'repositories')} studied over ${plural(weeks.length, 'ISO week')} (${esc(dLong(weeks[0].start))} – ${esc(dLong(D.generatedAt))}): commits and pull requests per month, CI health, flow and a quality scorecard for every project, plus one software-engineering report per week. Counted from git and the GitHub API, never typed.</p>
    <p class="callout"><strong>Read as proxies, not a benchmark.</strong> One maintainer directs AI agents across every repository, so review counts are near zero by construction and throughput says little about effort. Each metric, its source and its blind spot is in the <a href="#method">method</a>.</p>
    <div class="cta">
      <a class="btn btn--solid" href="/engineering/weeks/${latest.id}/">Latest weekly report: week ${weekNo(latest.id)}</a>
      <a class="btn btn--ghost" href="#projects">Every project, by month</a>
    </div>
   </div>
   <aside class="now" aria-labelledby="now-title">
    <p class="mono now__k">ISO ${latest.id}${latest.partial ? ' · in progress' : ''}</p>
    <h2 id="now-title">Week ${weekNo(latest.id)} <span>${esc(rangeLabel(latest))}</span></h2>
    <dl>
      <div><dt>commits</dt><dd>${n(lw.commits)}</dd></div>
      <div><dt>PRs merged</dt><dd>${n(lw.prMerged)}</dd></div>
      <div><dt>CI green</dt><dd>${pct(lw.successRate)}</dd></div>
      <div><dt>median lead time</dt><dd>${hrs(lw.leadMedianH)}</dd></div>
      <div><dt>releases</dt><dd>${n(lw.releases)}</dd></div>
      <div><dt>active projects</dt><dd>${n(lw.activeRepos)}</dd></div>
    </dl>
    <a class="now__go" href="/engineering/weeks/${latest.id}/">Read the week ${weekNo(latest.id)} report →</a>
   </aside>
  </div>
</section>

<section class="esec esec--white" aria-labelledby="fleet-title">
  <div class="wrap">
    <h2 id="fleet-title">The fleet at a glance</h2>
    ${kpis([
      ['Commits', n(T.commits), `${n(T.merges)} merge commits not counted`],
      ['Pull requests merged', n(T.prMerged), `${n(T.prOpened)} opened, ${n(T.prClosed)} closed unmerged`],
      ['Median PR lead time', hrs(T.leadMedianH), `p90 ${hrs(T.leadP90H)}, non-bot change PRs`],
      ['CI runs', n(T.runs), `${pct(T.successRate)} of decided runs green`],
      ['Change-failure proxy', pct(T.changeFailRate), `${n(T.redPushes)} of ${n(T.pushes)} pushes to develop/main went red`],
      ['Median time to restore', hrs(T.restoreMedianH), `${n(T.restoreN)} red-to-green recoveries`],
      ['Releases', n(T.releases), 'published GitHub releases'],
      ['Median project score', fleetScoreMedian == null ? '—' : String(Math.round(fleetScoreMedian)), 'of 100, last four ISO weeks + HEAD'],
    ])}
  </div>
</section>

<section class="esec" aria-labelledby="months-title">
  <div class="wrap">
    <h2 id="months-title">Month by month</h2>
    <p class="sec-lede">Commits, pull requests and CI for the whole fleet per calendar month (UTC). The first month starts at the first commit and the last one runs to the day of counting.</p>
    ${bars({ labels: months.map((m) => m.label.split(' ')[0]), series: [{ name: 'commits', cls: 'a', values: months.map((m) => om[m.id]?.commits || 0) }, { name: 'PRs merged', cls: 'b', values: months.map((m) => om[m.id]?.prMerged || 0) }], label: `Commits and merged pull requests per month: ${months.map((m) => `${m.label} ${n(om[m.id]?.commits)} commits, ${n(om[m.id]?.prMerged)} merged PRs`).join('; ')}` })}
    ${tableWrap('Fleet metrics per month', `<table class="t"><caption>Fleet metrics per month</caption><thead><tr><th scope="col">Month</th><th scope="col">Commits</th><th scope="col">PRs opened</th><th scope="col">PRs merged</th><th scope="col">Median lead time</th><th scope="col">CI runs</th><th scope="col">CI success</th><th scope="col">Change-fail proxy</th><th scope="col">Time to restore</th><th scope="col">Releases</th><th scope="col">Active projects</th></tr></thead><tbody>${monthRows}</tbody></table>`)}
  </div>
</section>

<section class="esec esec--white" aria-labelledby="weeks-title">
  <div class="wrap">
    <h2 id="weeks-title">Week by week</h2>
    <p class="sec-lede">Every ISO week has its own report: DORA-style proxies, flow, quality signals, risks and every merged pull request. The four weeks before the latest averaged ${n(Math.round(sum(lastWeeks.map((x) => x.prMerged)) / Math.max(1, lastWeeks.length)))} merged PRs and ${n(Math.round(sum(lastWeeks.map((x) => x.commits)) / Math.max(1, lastWeeks.length)))} commits a week; week ${weekNo(latest.id)}${latest.partial ? ' (in progress)' : ''} has ${n(lw.prMerged)} and ${n(lw.commits)}.</p>
    ${bars({ labels: weeks.map((w) => `W${weekNo(w.id)}`), series: [{ name: 'commits', cls: 'a', values: weeks.map((w) => ow[w.id]?.commits || 0) }, { name: 'PRs merged', cls: 'b', values: weeks.map((w) => ow[w.id]?.prMerged || 0) }], label: 'Commits and merged pull requests per ISO week' })}
    ${bars({ labels: weeks.map((w) => `W${weekNo(w.id)}`), series: [{ name: 'green runs', cls: 'ok', values: weeks.map((w) => ow[w.id]?.ok || 0) }, { name: 'red runs', cls: 'bad', values: weeks.map((w) => ow[w.id]?.fail || 0) }, { name: 'cancelled', cls: 'na', values: weeks.map((w) => ow[w.id]?.cancelled || 0) }], stacked: true, height: 150, label: 'GitHub Actions runs per ISO week by outcome' })}
    ${tableWrap('Weekly reports', `<table class="t"><caption>Weekly reports, newest first</caption><thead><tr><th scope="col">Report</th><th scope="col">Dates (UTC)</th><th scope="col">Commits</th><th scope="col">PRs merged</th><th scope="col">CI success</th><th scope="col">Median lead time</th><th scope="col">Change-fail proxy</th><th scope="col">Releases</th></tr></thead><tbody>${weekRows}</tbody></table>`)}
  </div>
</section>

<section class="esec" id="projects" aria-labelledby="projects-title">
  <div class="wrap">
    <h2 id="projects-title">Every project, by month</h2>
    <p class="sec-lede">Each project links to its own study. Cells are shaded by volume on one scale for the whole table; the score is the mean of the seven signals below; <em>CI 4w</em> is the green share of decided runs over the last four ISO weeks.</p>
    ${matrixTable('commits', 'Commits', 'm-commits')}
    ${matrixTable('prMerged', 'Merged pull requests', 'm-prs')}
  </div>
</section>

<section class="esec esec--white" id="scorecard" aria-labelledby="score-title">
  <div class="wrap">
    <h2 id="score-title">Quality scorecard</h2>
    <p class="sec-lede">Seven signals, each scored 0–100 against a stated target; a signal without data is left out of the mean rather than counted as zero. Flow signals use the last four ISO weeks (${esc(D.trailing.join(', '))}${weeks[weeks.length - 1].partial ? ', the last one to date' : ''}), so a young repository is scored on what exists; tests and harness are read at HEAD of the default branch.</p>
    <dl class="sig">${SIGNALS.map(([k, label, def, target]) => `<div><dt>${label}</dt><dd>${def}. Target ${target}. Fleet median ${fleetMedian(k) == null ? '—' : Math.round(fleetMedian(k))}.</dd></div>`).join('')}</dl>
    ${tableWrap('Quality scorecard', `<table class="t t--score"><caption>Projects ranked by score</caption><thead><tr><th scope="col">#</th><th scope="col">Project</th><th scope="col">Group</th><th scope="col">Score</th>${SIGNALS.map(([, label]) => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${scoreRows}</tbody></table>`)}
  </div>
</section>

<section class="esec" id="method" aria-labelledby="method-title">
  <div class="wrap method">
    <h2 id="method-title">Method, sources and blind spots</h2>
    <div class="cols">
      <div>
        <h3>Where the numbers come from</h3>
        <ul class="ticks ticks--plain">
          <li><b>git</b>, read from <code>origin/&lt;default&gt;</code> plus <code>origin/main</code> of each clone after a fetch, never a working tree. A commit counts once even when it is on both branches.</li>
          <li><b>GitHub GraphQL</b> for every pull request: timestamps, base and head branch, additions and deletions, author type, approvals.</li>
          <li><b>GitHub REST</b> for every Actions workflow run, queried one week at a time because filtered listings stop at 1,000 results, and for published releases.</li>
          <li>Weeks are ISO weeks (Monday to Sunday, UTC). Months are calendar months (UTC). The current week and month are partial and marked.</li>
          <li>Scope: the ${n(D.scope.repos)} active repositories of the organisation; the <code>.github</code> profile repository is skipped.</li>
        </ul>
      </div>
      <div>
        <h3>Definitions</h3>
        <ul class="ticks ticks--plain">
          <li><b>Commits</b> exclude merge commits. <b>Bot</b> commits and PRs are those authored by Dependabot and other <code>[bot]</code> accounts.</li>
          <li><b>Lead time</b> is PR opened → merged for non-bot PRs into the default branch; release PRs (develop → main) and back-merges (main → develop) are excluded. True DORA lead time runs to production, which a study fleet does not have.</li>
          <li><b>Change-failure proxy</b>: share of distinct pushes to develop/main where any workflow ended red. <b>Time to restore</b>: from a workflow's first red run on such a branch to its next green run.</li>
          <li><b>Deployment frequency</b> is approximated by published GitHub releases.</li>
          <li><b>Lines</b> by class: code, test (<code>_test.go</code>, <code>*.spec.ts</code>, <code>.feature</code>, test folders), api (OpenAPI / AsyncAPI), docs, conf, gen (generated, vendored, dist, and the contract copies mirrored into <code>ecosystem</code> and <code>warehouse-docs</code>), other (fixtures, assets). Lockfiles are never counted. Tracked lines at HEAD come from <code>git grep -c</code> over text files.</li>
        </ul>
      </div>
      <div>
        <h3>Blind spots</h3>
        <ul class="ticks ticks--plain">
          <li>Approvals are near zero: one human maintainer, branch protection without required reviewers. The gate is CI, not review, and the scorecard does not reward or punish review.</li>
          <li>Co-author trailers for AI models are a floor, never a share: agents that leave no trailer are invisible to git.</li>
          <li>Workflow-run duration is <code>updated_at − run_started_at</code>, which includes queueing on re-runs.</li>
          <li>Test lines per code line is a size ratio, not coverage. Coverage and mutation scores live in each repository's CI.</li>
          <li>Commit and PR counts measure throughput of agent-driven work; they are not a proxy for human effort or value.</li>
        </ul>
      </div>
    </div>
  </div>
</section>`;
    page({ path: '/engineering/', title: 'Engineering study', current: 'overview', description: `A study project, not a product. Software-engineering study of the ${D.scope.repos} IQVO repositories: quality, pull requests and commits per month, and one report per week.`, body });
  }

  // ============================================================ WEEKLY INDEX
  {
    const ow = D.orgWeeks;
    const cards = [...weeks].reverse().map((w) => { const x = ow[w.id] || {}; return `<li class="wcard"><a href="/engineering/weeks/${w.id}/"><span class="mono wcard__k">${w.id}${w.partial ? ' · in progress' : ''}</span><b>Week ${weekNo(w.id)}</b><span class="wcard__d">${esc(rangeLabel(w))}</span><span class="wcard__m mono">${n(x.commits)} commits · ${n(x.prMerged)} PRs merged · CI ${pct(x.successRate)}</span></a></li>`; }).join('');
    page({ path: '/engineering/weeks/', title: 'Weekly reports', current: 'weeks', description: `A study project, not a product. One software-engineering report per ISO week for the IQVO fleet, ${weeks.length} weeks so far.`, body: `
<section class="ehero ehero--sm"><div class="wrap">
  ${crumbs([['/engineering/', 'Engineering study'], ['/engineering/weeks/', 'Weekly reports']])}
  <h1>Weekly engineering <em>reports</em></h1>
  <p class="lede">${plural(weeks.length, 'ISO week')} from ${esc(dLong(weeks[0].start))}. Each report reads the week through a software-engineering lens: delivery (DORA-style proxies), flow, quality signals, risks left open at the end of the week, and every pull request merged.</p>
</div></section>
<section class="esec esec--white" aria-label="All weekly reports"><div class="wrap"><ul class="wcards">${cards}</ul></div></section>` });
  }

  // ============================================================ WEEKLY REPORTS
  weeks.forEach((w, i) => {
    const ow = D.orgWeeks; const x = ow[w.id] || {}; const prevW = weeks[i - 1]; const p = prevW ? ow[prevW.id] || {} : null;
    const nextW = weeks[i + 1];
    const det0 = D.weekDetail[w.id];
    // release PRs (develop -> main) are big by construction: they are not batch-size risks
    const det = { ...det0, large: det0.large.filter((m) => !m.release) };
    const prior4 = weeks.slice(Math.max(0, i - 4), i).map((k) => ow[k.id] || {});
    const avg = (key) => (prior4.length ? sum(prior4.map((k) => k[key])) / prior4.length : null);
    const perRepo = repos.map((r) => ({ r, x: r.weeks[w.id] })).filter((o) => o.x && (o.x.commits || o.x.prMerged || o.x.runs || o.x.prOpened));
    const addCode = lines(x.add, CODE_KEYS), addTest = lines(x.add, TEST_KEYS);

    // ---- findings, every one computed from the numbers above
    const F = [];
    const busiest = [...perRepo].sort((a, b) => b.x.commits - a.x.commits).slice(0, 3).filter((o) => o.x.commits);
    F.push(`${plural(x.commits || 0, 'commit')} and ${plural(x.prMerged || 0, 'merged pull request')} across ${plural(x.activeRepos || 0, 'active project')}${p ? ` (previous week: ${n(p.commits)} and ${n(p.prMerged)})` : ''}.${busiest.length ? ` Busiest: ${busiest.map((o) => `${o.r.name} (${n(o.x.commits)})`).join(', ')}.` : ''}`);
    if (x.successRate != null) {
      const worst = perRepo.filter((o) => o.x.ok + o.x.fail >= 5).sort((a, b) => a.x.successRate - b.x.successRate)[0];
      F.push(`CI: ${pct(x.successRate)} of ${n(x.ok + x.fail)} decided runs were green${p?.successRate != null ? ` (previous week ${pct(p.successRate)})` : ''}.${worst && worst.x.successRate < 90 ? ` Lowest: ${worst.r.name} at ${pct(worst.x.successRate)} (${n(worst.x.fail)} red).` : ''}`);
    }
    if (x.leadMedianH != null) F.push(`Median PR lead time ${hrs(x.leadMedianH)} (p90 ${hrs(x.leadP90H)}) over ${plural(x.leadN, 'non-bot change PR')}; ${pct(x.smallShare)} of them changed at most 400 lines${p?.leadMedianH != null ? `; previous week's median was ${hrs(p.leadMedianH)}` : ''}.`);
    if (x.changeFailRate != null) F.push(`${n(x.redPushes)} of ${n(x.pushes)} pushes to develop/main went red (${pct(x.changeFailRate)})${x.restoreN ? `; ${plural(x.restoreN, 'red workflow')} recovered, median ${hrs(x.restoreMedianH)} to green` : ''}.`);
    if (det.releases.length) F.push(`${plural(det.releases.length, 'release')} published by ${plural(new Set(det.releases.map((r) => r.repo)).size, 'project')}.`);
    else F.push('No GitHub release was published this week.');
    if (addCode) F.push(`${n(addTest)} test lines were added for ${n(addCode)} code lines (${(addTest / addCode).toFixed(2)} per code line); ${n(lines(x.add, ['docs']))} documentation and ${n(lines(x.add, ['api']))} API-contract lines.`);
    if (x.conventional != null) F.push(`${pct(x.conventional)} of non-bot commit subjects follow Conventional Commits; ${plural(x.reverts, 'revert')}, ${plural(x.fixes, 'fix commit')}.`);
    const risks = [];
    if (det.red.length) risks.push(`${plural(det.red.length, 'workflow')} went red this week and had not turned green again by the time of counting`);
    if (det.stale.length) risks.push(`${plural(det.stale.length, 'pull request')} open for more than 7 days at the end of the week`);
    if (det.large.length) risks.push(`${plural(det.large.length, 'non-bot change PR')} over 1,000 changed lines merged`);
    if (x.direct) risks.push(`${plural(x.direct, 'change')} landed on a default branch without a pull request`);
    F.push(risks.length ? `Watch: ${risks.join('; ')}.` : 'No open risk signal: nothing left red, no stale or oversized PR, nothing landed without a PR.');
    if (det.newRepos.length) F.push(`New ${det.newRepos.length === 1 ? 'repository' : 'repositories'}: ${det.newRepos.join(', ')}.`);
    if (w.partial) F.unshift(`This week is still in progress: counted ${dLong(D.generatedAt)}, day ${Math.max(1, Math.ceil((Date.parse(D.generatedAt) - Date.parse(`${w.start}T00:00:00Z`)) / 86400000))} of 7.`);

    const dora = [
      ['Deployment frequency', `${n(x.releases)}`, 'releases', delta(x.releases, p?.releases, { fmt: n }), avg('releases')],
      ['Lead time for changes', hrs(x.leadMedianH), 'median PR open → merge', delta(x.leadMedianH, p?.leadMedianH, { lowerIsBetter: true, fmt: hrs }), null],
      ['Change-failure proxy', pct(x.changeFailRate), 'red pushes to develop/main', delta(x.changeFailRate, p?.changeFailRate, { lowerIsBetter: true, unit: ' pts', fmt: (v) => v.toFixed(1) }), avg('changeFailRate')],
      ['Time to restore', hrs(x.restoreMedianH), 'median red → green', delta(x.restoreMedianH, p?.restoreMedianH, { lowerIsBetter: true, fmt: hrs }), null],
    ];
    const groupRows = groups.map((g) => {
      const xs = g.repos.map((r) => r.weeks[w.id]).filter(Boolean);
      const ok = sum(xs.map((k) => k.ok)), fail = sum(xs.map((k) => k.fail)), pushes = sum(xs.map((k) => k.pushes)), red = sum(xs.map((k) => k.redPushes));
      return `<tr><th scope="row">${esc(g.label)}</th><td>${n(sum(xs.map((k) => k.commits)))}</td><td>${n(sum(xs.map((k) => k.prMerged)))}</td><td>${n(ok + fail + sum(xs.map((k) => k.cancelled + k.otherRuns)))}</td><td class="r-${rateCls(ok + fail ? (100 * ok) / (ok + fail) : null)}">${ok + fail ? pct((100 * ok) / (ok + fail)) : '—'}</td><td>${pushes ? pct((100 * red) / pushes) : '—'}</td><td>${n(sum(xs.map((k) => k.releases)))}</td></tr>`;
    }).join('');
    const repoRows = [...perRepo].sort((a, b) => b.x.commits - a.x.commits || b.x.prMerged - a.x.prMerged).map(({ r, x: y }) => `<tr><th scope="row"><a href="/engineering/projects/${r.name}/">${esc(r.name)}</a></th><td>${n(y.commits)}</td><td>${n(y.prOpened)}</td><td>${n(y.prMerged)}</td><td>${hrs(y.leadMedianH)}</td><td>${n(y.runs)}</td><td class="r-${rateCls(y.successRate)}">${pct(y.successRate)}</td><td>${y.pushes ? `${n(y.redPushes)} / ${n(y.pushes)}` : '—'}</td><td>${n(y.releases)}</td><td>+${n(lines(y.add, CODE_KEYS))}</td><td>+${n(lines(y.add, TEST_KEYS))}</td></tr>`).join('');
    const prLink = (row) => { const r = D.repos[row.repo]; const u = gh(r); return u ? `<a href="${u}/pull/${row.n}" rel="noopener">#${row.n}</a>` : `#${row.n}`; };
    const byRepo = {}; for (const m of det.merged) (byRepo[m.repo] ||= []).push(m);
    const mergedHtml = Object.entries(byRepo).sort((a, b) => b[1].length - a[1].length).map(([repo, list]) => `<details class="prs"><summary><b>${esc(repo)}</b> <span class="muted">· ${plural(list.length, 'PR')}</span></summary><ul>${list.map((m) => `<li><span class="mono">${prLink(m)}</span> ${esc(m.title)} <span class="muted mono">+${n(m.add)} −${n(m.del)} · ${hrs(m.leadH)}${m.bot ? ' · bot' : ''}${m.release ? ' · release/back-merge' : ''}</span></li>`).join('')}</ul></details>`).join('') || '<p class="muted">No pull request was merged this week.</p>';
    const list = (arr, fmt, empty, max = 15) => (arr.length ? `<ul class="ticks ticks--plain">${arr.slice(0, max).map(fmt).join('')}</ul>${arr.length > max ? `<p class="muted">…and ${n(arr.length - max)} more.</p>` : ''}` : `<p class="muted">${empty}</p>`);
    const relList = list(det.releases, (r) => `<li><b>${esc(r.repo)}</b> <span class="mono">${esc(r.tag)}</span> <span class="muted">${esc(dShort(r.at))}${r.pre ? ' · pre-release' : ''}</span></li>`, 'None.', Infinity);

    const body = `
<section class="ehero ehero--sm"><div class="wrap">
  ${crumbs([['/engineering/', 'Engineering study'], ['/engineering/weeks/', 'Weekly reports'], [`/engineering/weeks/${w.id}/`, `Week ${weekNo(w.id)}`]])}
  <p class="kicker">Weekly engineering report · ISO ${w.id}${w.partial ? ' · in progress' : ''}</p>
  <h1>Week ${weekNo(w.id)}: <em>${esc(rangeLabel(w))}</em></h1>
  <nav class="pager mono" aria-label="Other weeks">${prevW ? `<a href="/engineering/weeks/${prevW.id}/" rel="prev">← Week ${weekNo(prevW.id)}</a>` : '<span></span>'}${nextW ? `<a href="/engineering/weeks/${nextW.id}/" rel="next">Week ${weekNo(nextW.id)} →</a>` : '<span></span>'}</nav>
</div></section>

<section class="esec esec--white" aria-labelledby="sum-title"><div class="wrap">
  <h2 id="sum-title">Summary</h2>
  <ul class="findings">${F.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
</div></section>

<section class="esec" aria-labelledby="dora-title"><div class="wrap">
  <h2 id="dora-title">Delivery: the four keys, as proxies</h2>
  <p class="sec-lede">DORA's four keys adapted to a fleet without production traffic; definitions in the <a href="/engineering/#method">method</a>.</p>
  <dl class="kpis kpis--4">${dora.map(([label, value, note, d, a]) => `<div class="kpi"><dt>${label}</dt><dd>${value}</dd><p class="kpi__note">${note}</p><p class="kpi__note">${d}</p>${a != null ? `<p class="kpi__note">4-week average before: ${label.startsWith('Change') ? pct(a) : n(Math.round(a * 10) / 10)}</p>` : ''}</div>`).join('')}</dl>
</div></section>

<section class="esec esec--white" aria-labelledby="flow-title"><div class="wrap">
  <h2 id="flow-title">Flow and quality signals</h2>
  <div class="cols cols--2">
    <div>
      <h3>Flow</h3>
      ${kpis([
        ['Commits', n(x.commits), `${n(x.bot)} by bots · ${n(x.authors)} distinct authors`],
        ['PRs merged', n(x.prMerged), `${n(x.prBot)} bot · ${n(x.prRelease)} release/back-merge · ${n(x.prOpened)} opened · ${n(x.prClosed)} closed unmerged`],
        ['Median PR size', x.sizeMedian == null ? '—' : `${n(x.sizeMedian)} lines`, `${pct(x.smallShare)} at most 400 lines`],
        ['Through a PR', pct(x.prShare), `${n(x.viaPr)} via PR · ${n(x.direct)} direct`],
        ['Approved PRs', pct(x.approvedShare), 'single-maintainer fleet: CI is the gate'],
        ['AI co-author trailers', n(x.ai), 'commits with one; a floor, never a share'],
      ])}
    </div>
    <div>
      <h3>Quality</h3>
      ${kpis([
        ['CI runs', n(x.runs), `${n(x.ok)} green · ${n(x.fail)} red · ${n(x.cancelled)} cancelled`],
        ['CI success', pct(x.successRate), delta(x.successRate, p?.successRate, { unit: ' pts', fmt: (v) => v.toFixed(1) })],
        ['Median run time', x.durMedianMin == null ? '—' : `${x.durMedianMin.toFixed(1)} min`, 'completed runs'],
        ['Test : code lines added', addCode ? (addTest / addCode).toFixed(2) : '—', `+${n(addTest)} test · +${n(addCode)} code`],
        ['Conventional subjects', pct(x.conventional), `${n(x.humanCommits)} non-bot commits`],
        ['Reverts · fixes', `${n(x.reverts)} · ${n(x.fixes)}`, 'commit subjects'],
      ])}
    </div>
  </div>
</div></section>

<section class="esec" aria-labelledby="risk-title"><div class="wrap">
  <h2 id="risk-title">Risks left open</h2>
  <div class="cols">
    <div><h3>Still red</h3>${list(det.red, (r) => `<li><b>${esc(r.repo)}</b> · ${esc(r.workflow)} on <code>${esc(r.branch)}</code> <span class="muted">since ${esc(dShort(r.since))}</span></li>`, 'Every workflow that went red on develop/main this week was green again.')}</div>
    <div><h3>Open more than 7 days</h3>${list(det.stale, (s) => `<li><b>${esc(s.repo)}</b> #${s.n} ${esc(s.title)} <span class="muted">${n(s.ageD)} d${s.bot ? ' · bot' : ''}</span></li>`, 'No stale pull request.')}</div>
    <div><h3>Over 1,000 lines <span class="muted">(release and back-merge PRs excluded)</span></h3>${list(det.large, (m) => `<li><b>${esc(m.repo)}</b> #${m.n} ${esc(m.title)} <span class="muted">+${n(m.add)} −${n(m.del)}</span></li>`, 'No oversized non-bot pull request.')}</div>
  </div>
</div></section>

<section class="esec esec--white" aria-labelledby="by-title"><div class="wrap">
  <h2 id="by-title">By program and by project</h2>
  ${tableWrap('By program', `<table class="t"><caption>By program</caption><thead><tr><th scope="col">Program</th><th scope="col">Commits</th><th scope="col">PRs merged</th><th scope="col">CI runs</th><th scope="col">CI success</th><th scope="col">Change-fail proxy</th><th scope="col">Releases</th></tr></thead><tbody>${groupRows}</tbody></table>`)}
  ${tableWrap('By project', `<table class="t"><caption>${plural(perRepo.length, 'active project')}, busiest first</caption><thead><tr><th scope="col">Project</th><th scope="col">Commits</th><th scope="col">PRs opened</th><th scope="col">PRs merged</th><th scope="col">Lead time</th><th scope="col">CI runs</th><th scope="col">CI success</th><th scope="col">Red pushes</th><th scope="col">Releases</th><th scope="col">Code lines</th><th scope="col">Test lines</th></tr></thead><tbody>${repoRows || '<tr><td colspan="11">No activity.</td></tr>'}</tbody></table>`)}
</div></section>

<section class="esec" aria-labelledby="rel-title"><div class="wrap">
  <div class="cols cols--2">
    <div><h2 id="rel-title">Releases</h2>${relList}</div>
    <div><h2>Merged pull requests</h2>${mergedHtml}</div>
  </div>
</div></section>`;
    page({ path: `/engineering/weeks/${w.id}/`, title: `Week ${weekNo(w.id)} (${w.id}) report`, current: 'weeks', description: `A study project, not a product. IQVO weekly engineering report for ${w.id}: ${x.commits || 0} commits, ${x.prMerged || 0} merged PRs, CI ${pct(x.successRate)} green.`, body });
  });

  // ============================================================ PROJECT STUDIES
  for (const r of repos) {
    const T = r.total; const S = r.score; const url = gh(r);
    const cmp = (key) => { const f = fleetMedian(key); return f == null ? '' : ` · fleet median ${Math.round(f)}`; };
    const sigRows = SIGNALS.map(([k, label, def, target]) => `<li class="meter"><span class="meter__l">${label}</span><progress max="100" value="${S[k] ?? 0}" aria-label="${esc(label)}: ${S[k] == null ? 'no data' : `${S[k]} of 100`}"></progress><b class="r-${rateCls(S[k], 80, 60)}">${S[k] == null ? 'n/a' : S[k]}</b><span class="meter__d muted">${def}. Target ${target}${cmp(k)}.</span></li>`).join('');
    const monthRows = months.map((m) => { const x = r.months[m.id]; if (!x) return `<tr><th scope="row">${esc(m.label)}</th><td colspan="12" class="muted">no activity</td></tr>`; return `<tr><th scope="row">${esc(m.label)}${m.partial ? ' <span class="tag">to date</span>' : ''}</th><td>${n(x.commits)}</td><td>${n(x.prOpened)}</td><td>${n(x.prMerged)}</td><td>${n(x.prClosed)}</td><td>${hrs(x.leadMedianH)}</td><td>${x.sizeMedian == null ? '—' : n(x.sizeMedian)}</td><td>${n(x.runs)}</td><td class="r-${rateCls(x.successRate)}">${pct(x.successRate)}</td><td>${pct(x.changeFailRate)}</td><td>${n(x.releases)}</td><td>+${n(lines(x.add, CODE_KEYS))}</td><td>+${n(lines(x.add, TEST_KEYS))}</td></tr>`; }).join('');
    const harnessList = Object.entries(r.harness).map(([k, v]) => `<li class="${v ? 'hk hk--y' : 'hk hk--n'}"><span aria-hidden="true">${v ? '✓' : '✗'}</span> ${esc(HARNESS_LABEL[k] || k)}<span class="sr">: ${v ? 'present' : 'missing'}</span></li>`).join('');
    const wf = r.workflows.map((x) => { const sr = x.ok + x.fail ? (100 * x.ok) / (x.ok + x.fail) : null; return `<tr><th scope="row">${esc(x.name)}</th><td>${n(x.runs)}</td><td class="r-${rateCls(sr)}">${pct(sr)}</td></tr>`; }).join('');
    const prs = r.recentMerged.map((m) => `<li><span class="mono">${url ? `<a href="${url}/pull/${m.n}" rel="noopener">#${m.n}</a>` : `#${m.n}`}</span> ${esc(m.title)} <span class="muted mono">${esc(dShort(m.at))} · +${n(m.add)} −${n(m.del)} · ${hrs(m.leadH)}${m.bot ? ' · bot' : ''}${m.release ? ' · release/back-merge' : ''}</span></li>`).join('');
    const rels = r.releases.map((x) => `<li><span class="mono">${esc(x.t)}</span> <span class="muted">${esc(dLong(x.d))}${x.pre ? ' · pre-release' : ''}</span></li>`).join('');

    // observations: computed comparisons against the fleet and against itself
    const O = [];
    const tw = D.trailing; const prev4 = weeks.slice(-8, -4).map((w) => w.id);
    const win = (ids, key) => sum(ids.map((id) => r.weeks[id]?.[key]));
    const leadNow = median(tw.map((id) => r.weeks[id]?.leadMedianH)); const leadBefore = median(prev4.map((id) => r.weeks[id]?.leadMedianH));
    if (S.total != null) O.push(`Score ${S.total} of 100, ${fleetScoreMedian == null ? '' : S.total >= fleetScoreMedian ? 'at or above' : 'below'} the fleet median of ${Math.round(fleetScoreMedian)}.`);
    const weakest = SIGNALS.filter(([k]) => S[k] != null).sort((a, b) => S[a[0]] - S[b[0]])[0];
    if (weakest && S[weakest[0]] < 80) O.push(`Weakest signal: ${weakest[1].toLowerCase()} at ${S[weakest[0]]}.`);
    O.push(`Last four ISO weeks: ${plural(win(tw, 'commits'), 'commit')} and ${plural(win(tw, 'prMerged'), 'merged PR')}; the four before: ${n(win(prev4, 'commits'))} and ${n(win(prev4, 'prMerged'))}.`);
    if (leadNow != null && leadBefore != null) O.push(`Median weekly PR lead time ${hrs(leadNow)} over the last four weeks, against ${hrs(leadBefore)} in the four before.`);
    if (S.testRatio != null) O.push(`${S.testRatio.toFixed(2)} test lines per code line at HEAD (fleet median ${median(repos.map((x) => x.score.testRatio))?.toFixed(2) ?? '—'}).`);
    const missingH = Object.entries(r.harness).filter(([, v]) => !v).map(([k]) => HARNESS_LABEL[k] || k);
    if (missingH.length) O.push(`Harness gaps at HEAD: ${missingH.join(', ')}.`);
    if (!r.releases.length) O.push('No GitHub release has been published.');
    if (T.ai) O.push(`${plural(T.ai, 'commit')} carry an AI co-author trailer (a floor: not every agent leaves one).`);

    const body = `
<section class="ehero ehero--sm"><div class="wrap">
  ${crumbs([['/engineering/', 'Engineering study'], ['/engineering/#projects', 'Projects'], [`/engineering/projects/${r.name}/`, r.name]])}
  <p class="kicker">${esc(groupLabel[r.group])}${r.classification ? ` · ${esc(r.classification)} domain` : ''}</p>
  <h1>${esc(r.name)}</h1>
  ${r.description ? `<p class="lede">${esc(r.description)}</p>` : ''}
  <p class="meta mono">${[r.language && `language ${esc(r.language)}`, `created ${esc(dLong(r.createdAt))}`, `default branch <code>${esc(r.defaultBranch)}</code>`, r.lastTag && `latest tag <code>${esc(r.lastTag)}</code>`, url ? `<a href="${url}" rel="noopener">GitHub ↗</a>` : 'private repository'].filter(Boolean).join(' · ')}</p>
</div></section>

<section class="esec esec--white" aria-labelledby="sc-title"><div class="wrap">
  <div class="scorehead"><h2 id="sc-title">Quality scorecard</h2><p class="bigscore r-${rateCls(S.total, 80, 60)}" aria-label="Score ${S.total ?? 'not available'} of 100"><b>${S.total ?? '—'}</b><span>/ 100</span></p></div>
  <ul class="meters">${sigRows}</ul>
  <h3>Observations</h3>
  <ul class="findings">${O.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>
</div></section>

<section class="esec" aria-labelledby="life-title"><div class="wrap">
  <h2 id="life-title">Since the first commit</h2>
  ${kpis([
    ['Commits', n(T.commits), `${n(T.bot)} by bots · ${n(T.merges)} merges not counted`],
    ['PRs merged', n(T.prMerged), `${n(T.prOpened)} opened · ${n(T.prClosed)} closed unmerged`],
    ['Median lead time', hrs(T.leadMedianH), `p90 ${hrs(T.leadP90H)}`],
    ['Median PR size', T.sizeMedian == null ? '—' : `${n(T.sizeMedian)} lines`, `${pct(T.smallShare)} at most 400 lines`],
    ['CI runs', n(T.runs), `${pct(T.successRate)} green`],
    ['Change-failure proxy', pct(T.changeFailRate), `${n(T.redPushes)} of ${n(T.pushes)} pushes red`],
    ['Releases', n(T.releases), `${n(r.tags)} tags`],
    ['Tracked lines', n(sum(Object.values(r.loc))), `${n(r.files)} text files at HEAD`],
  ])}
</div></section>

<section class="esec esec--white" aria-labelledby="mo-title"><div class="wrap">
  <h2 id="mo-title">Commits and pull requests per month</h2>
  ${bars({ labels: months.map((m) => m.label.split(' ')[0]), series: [{ name: 'commits', cls: 'a', values: months.map((m) => r.months[m.id]?.commits || 0) }, { name: 'PRs merged', cls: 'b', values: months.map((m) => r.months[m.id]?.prMerged || 0) }, { name: 'PRs opened', cls: 'c', values: months.map((m) => r.months[m.id]?.prOpened || 0) }], label: `${r.name}: ${months.map((m) => `${m.label} ${n(r.months[m.id]?.commits || 0)} commits, ${n(r.months[m.id]?.prMerged || 0)} merged PRs`).join('; ')}` })}
  ${tableWrap(`${r.name} per month`, `<table class="t"><caption>${esc(r.name)} per month</caption><thead><tr><th scope="col">Month</th><th scope="col">Commits</th><th scope="col">PRs opened</th><th scope="col">PRs merged</th><th scope="col">Closed unmerged</th><th scope="col">Median lead time</th><th scope="col">Median PR size</th><th scope="col">CI runs</th><th scope="col">CI success</th><th scope="col">Change-fail proxy</th><th scope="col">Releases</th><th scope="col">Code lines</th><th scope="col">Test lines</th></tr></thead><tbody>${monthRows}</tbody></table>`)}
</div></section>

<section class="esec" aria-labelledby="wk-title"><div class="wrap">
  <h2 id="wk-title">Week by week</h2>
  ${bars({ labels: weeks.map((w) => `W${weekNo(w.id)}`), series: [{ name: 'commits', cls: 'a', values: weeks.map((w) => r.weeks[w.id]?.commits || 0) }, { name: 'PRs merged', cls: 'b', values: weeks.map((w) => r.weeks[w.id]?.prMerged || 0) }], label: `${r.name}: commits and merged PRs per ISO week` })}
  ${bars({ labels: weeks.map((w) => `W${weekNo(w.id)}`), series: [{ name: 'green runs', cls: 'ok', values: weeks.map((w) => r.weeks[w.id]?.ok || 0) }, { name: 'red runs', cls: 'bad', values: weeks.map((w) => r.weeks[w.id]?.fail || 0) }, { name: 'cancelled', cls: 'na', values: weeks.map((w) => r.weeks[w.id]?.cancelled || 0) }], stacked: true, height: 140, label: `${r.name}: CI runs per ISO week by outcome` })}
</div></section>

<section class="esec esec--white" aria-labelledby="code-title"><div class="wrap">
  <h2 id="code-title">Code and harness</h2>
  <h3>Tracked lines at HEAD, by class</h3>
  ${classBar(r.loc, `${r.name}: tracked lines by class at HEAD`)}
  <h3>Lines added and deleted since the first commit</h3>
  ${tableWrap('Churn by class', `<table class="t"><thead><tr><th scope="col">Class</th>${D.classes.map((k) => `<th scope="col">${k}</th>`).join('')}</tr></thead><tbody><tr><th scope="row">added</th>${D.classes.map((k) => `<td>+${n(T.add[k])}</td>`).join('')}</tr><tr><th scope="row">deleted</th>${D.classes.map((k) => `<td>−${n(T.del[k])}</td>`).join('')}</tr></tbody></table>`)}
  <div class="cols cols--2">
    <div><h3>Harness checklist</h3><ul class="harness">${harnessList}</ul><p class="muted mono">${plural(r.harnessCounts.workflows, 'workflow')} · ${plural(r.harnessCounts.features, 'feature file')} · ${plural(r.harnessCounts.adrs, 'ADR')}</p></div>
    <div><h3>Busiest workflows</h3>${wf ? tableWrap('Workflows', `<table class="t"><thead><tr><th scope="col">Workflow</th><th scope="col">Runs</th><th scope="col">Success</th></tr></thead><tbody>${wf}</tbody></table>`) : '<p class="muted">No workflow runs.</p>'}</div>
  </div>
</div></section>

<section class="esec" aria-labelledby="pr-title"><div class="wrap">
  <div class="cols cols--2">
    <div><h2 id="pr-title">Recently merged</h2>${prs ? `<ul class="ticks ticks--plain">${prs}</ul>` : '<p class="muted">No merged pull request yet.</p>'}</div>
    <div><h2>Releases</h2>${rels ? `<ul class="ticks ticks--plain">${rels}</ul>` : '<p class="muted">No release published.</p>'}</div>
  </div>
</div></section>`;
    page({ path: `/engineering/projects/${r.name}/`, title: `${r.name} study`, current: 'projects', description: `A study project, not a product. Engineering study of ${r.name}: quality score ${S.total ?? 'n/a'}, ${T.commits} commits and ${T.prMerged} merged PRs, per month and per week.`, body });
  }

  return pages;
}

// Numbers for the landing page band (index.html placeholders).
export function engineeringView(data) {
  const latest = data.weeks[data.weeks.length - 1];
  const nf2 = new Intl.NumberFormat('en-US');
  return {
    repos: data.scope.repos,
    weeks: data.weeks.length,
    commits: nf2.format(data.total.commits),
    prMerged: nf2.format(data.total.prMerged),
    runs: nf2.format(data.total.runs),
    ci: data.total.successRate == null ? '—' : `${Math.round(data.total.successRate)}%`,
    lead: (() => { const h = data.total.leadMedianH; return h == null ? '—' : h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`; })(),
    latest: latest.id,
    latestNo: Number(latest.id.split('-W')[1]),
  };
}

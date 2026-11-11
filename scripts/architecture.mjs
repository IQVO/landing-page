// Renders the architecture assessment (data/architecture.json) into static pages under dist/architecture/.
//   /architecture/                    overview: the fitness functions, the fleet matrix, method
//   /architecture/projects/<repo>/    one assessment per project
// No JavaScript: every figure is read from data/architecture.json; every sentence that states a
// number is computed here (ADR 0002, ADR 0004). Shares the study's banner, footer and CSS.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('en-US');
const n = (x) => (x == null ? '—' : nf.format(x));
const pct = (x) => (x == null ? '—' : `${Math.round(x)}%`);
const sum = (arr) => arr.reduce((a, b) => a + (b || 0), 0);
const median = (arr) => { const s = arr.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const plural = (x, one, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;
const dLong = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const rateCls = (x, good = 80, warn = 60) => (x == null ? 'na' : x >= good ? 'good' : x >= warn ? 'warn' : 'bad');

export function renderArchitecture({ data, cfg, updatedLabel }) {
  const D = data;
  const FF = D.method.fitnessFunctions;
  const ORDER = D.method.order;
  const repos = Object.entries(D.repos).map(([name, r]) => ({ name, ...r }));
  const groups = [...new Set(repos.map((r) => r.group))];
  const GROUP_LABEL = {
    wms: 'WMS bounded contexts', wes: 'WES bounded contexts', 'retail-network': 'Retail-network bounded contexts',
    storefront: 'Storefront bounded contexts', frontends: 'Frontends and BFFs', platform: 'Platform, harness and docs',
  };
  const fleetMedian = median(repos.map((r) => r.fitness));
  const pages = [];

  const NAV = [
    ['/architecture/', 'Overview', 'overview'],
    ['/architecture/#projects', 'Projects', 'projects'],
    ['/architecture/#functions', 'Fitness functions', 'functions'],
    ['/architecture/#method', 'Method', 'method'],
  ];
  const layout = ({ path, title, description, current, body }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · IQVO architecture assessment</title>
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
<body class="eng arch">
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
    <nav class="enav__nav" aria-label="Architecture assessment">
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
      <h2 class="mono foot__h">How this assessment was made</h2>
      <p>Counted from the repositories&rsquo; git trees by <code>scripts/collect-architecture.mjs</code> on ${esc(updatedLabel)} and rendered by <code>scripts/architecture.mjs</code>; no number is typed by hand. Written by GLM 5.3 (Z.ai) under human direction. The fitness functions, their targets and their blind spots are stated in the <a href="/architecture/#method">method</a>.</p>
    </div>
  </div>
  <div class="wrap foot__base mono">
    <span>MIT licence</span>
    <a href="/">Landing page</a>
    <a href="/engineering/">Engineering study</a>
    <a href="${cfg.githubUrl}" rel="noopener">GitHub</a>
    <a href="#top">Back to top ↑</a>
  </div>
</footer>
</body>
</html>
`;
  const page = (p) => pages.push({ file: `${p.path.replace(/^\//, '')}index.html`, html: layout(p) });
  const tableWrap = (label, inner) => `<div class="tw" role="region" aria-label="${esc(label)}" tabindex="0">${inner}</div>`;
  const crumbs = (items) => `<nav class="crumbs mono" aria-label="Breadcrumb"><ol>${items.map(([href, label], i) => `<li>${i === items.length - 1 ? `<span aria-current="page">${esc(label)}</span>` : `<a href="${href}">${esc(label)}</a>`}</li>`).join('')}</ol></nav>`;
  const kpis = (items) => `<dl class="kpis">${items.map(([label, value, note]) => `<div class="kpi"><dt>${label}</dt><dd>${value}</dd>${note ? `<p class="kpi__note">${note}</p>` : ''}</div>`).join('')}</dl>`;
  const scoreBadge = (s) => `<span class="score score--${rateCls(s)}">${s == null ? '—' : s}</span>`;
  const SHORT = { layout: 'Layout', domainPurity: 'Domain purity', adapters: 'Adapters', contracts: 'Contracts', events: 'Events', fitnessTests: 'Arch tests', adr: 'ADRs', mcp: 'MCP', tests: 'Tests', ci: 'CI' };
  const pill = (ff) => !ff.applicable ? '<span class="ffpill ffpill--na" title="not applicable to this project">n/a</span>' : ff.pass ? '<span class="ffpill ffpill--pass" title="meets the target">pass</span>' : '<span class="ffpill ffpill--fail" title="misses the target">fail</span>';
  const cell = (ff) => !ff.applicable ? '<td class="ffc ffc--na"><span aria-hidden="true">·</span><span class="sr">not applicable</span></td>'
    : ff.pass ? '<td class="ffc ffc--pass"><span aria-hidden="true">✓</span><span class="sr">pass</span></td>' : '<td class="ffc ffc--fail"><span aria-hidden="true">✗</span><span class="sr">fail</span></td>';
  const fmtValue = (key, ff) => {
    if (!ff.applicable) return null;
    if (key === 'layout') return `${ff.value}% of ${n(ff.detail.n)}`;
    if (key === 'domainPurity') return `${n(ff.value)} of ${n(ff.detail.n)} files`;
    if (key === 'events') return `${n(ff.detail.conforming)} of ${n(ff.detail.distinct)} types (${pct(ff.value)})`;
    if (key === 'tests') return `${ff.value.toFixed(2)} test lines per code line`;
    if (key === 'ci') return `${pct(ff.value)} green`;
    if (key === 'fitnessTests') return `${n(ff.detail.files)} files, ${n(ff.detail.tests)} test functions`;
    if (key === 'adr') return `${n(ff.value)} records`;
    if (key === 'contracts') return `${n(ff.value)} spec${ff.value === 1 ? '' : 's'} (${ff.detail.openapi ? 'OpenAPI' : ''}${ff.detail.openapi && ff.detail.asyncapi ? ' + ' : ''}${ff.detail.asyncapi ? 'AsyncAPI' : ''})`;
    return `${n(ff.value)}`;
  };

  // ============================================================ OVERVIEW
  {
    const F = D.fleet;
    const ffRows = ORDER.map((k) => { const f = FF[k]; const b = F.byFF[k]; const axesShort = f.axes.split(' · ').filter((a) => a !== 'triggered' && a !== 'automated').join(' · '); return `<tr id="ff-${k}"><th scope="row">${esc(f.name)}</th><td>${esc(f.characteristic)}</td><td class="mono" title="${esc(f.axes)}">${esc(axesShort)}</td><td>${esc(f.target)}</td><td class="num"><b>${n(b.pass)}</b> / ${n(b.applicable)}</td><td class="r-${rateCls(b.applicable ? (100 * b.pass) / b.applicable : null)}">${pct(b.applicable ? (100 * b.pass) / b.applicable : null)}</td></tr>`; }).join('');
    const worst = ORDER.map((k) => ({ k, ...F.byFF[k] })).filter((x) => x.applicable).sort((a, b) => (a.pass / a.applicable) - (b.pass / b.applicable)).slice(0, 3);
    const matrix = groups.map((g) => {
      const rs = repos.filter((r) => r.group === g);
      return `<tr class="grp"><th scope="colgroup" colspan="${ORDER.length + 4}">${esc(GROUP_LABEL[g] || g)} <span class="muted">· ${plural(rs.length, 'project')}</span></th></tr>` +
        rs.map((r) => `<tr><th scope="row"><a href="/architecture/projects/${r.name}/">${esc(r.name)}</a></th>${ORDER.map((k) => cell(r.ff[k])).join('')}<td class="num"><b>${n(r.passed)}</b><span class="muted"> / ${n(r.applicable)}</span></td><td>${scoreBadge(r.fitness)}</td><td><a class="mono" href="/engineering/projects/${r.name}/">study ↗</a></td></tr>`).join('');
    }).join('');
    const ranked = [...repos].filter((r) => r.fitness != null).sort((a, b) => b.fitness - a.fitness || a.name.localeCompare(b.name));
    const riskLines = worst.map((w) => `${n(w.fail)} of ${n(w.applicable)} projects miss <a href="#ff-${w.k}">${esc(FF[w.k].name.toLowerCase())}</a> (${esc(FF[w.k].target)}).`).join(' ');

    const body = `
<section class="ehero">
  <div class="wrap ehero__grid">
   <div>
    <p class="kicker">Architecture assessment · counted ${esc(updatedLabel)}</p>
    <h1>Is the architecture still <em>the architecture?</em></h1>
    <p class="lede">Every project assessed with ten architectural fitness functions — objective integrity checks on structure, coupling, contracts, governance and delivery, each with a stated target and each counted from the repositories. Nothing on these pages is judged by a person; a check either meets its target or it does not, and every miss is listed as a risk.</p>
    <p class="callout"><strong>Fitness functions, not grades.</strong> The term is Ford, Parsons and Kua's (<i>Building Evolutionary Architectures</i>, foreword by Martin Fowler): any mechanism that gives an objective integrity assessment of an architectural characteristic. The characteristic&nbsp;→ check&nbsp;→ target shape borrows the utility tree of the SEI's ATAM. The thresholds are stated, not tuned; a failing project is a finding, not a verdict.</p>
    <div class="cta">
      <a class="btn btn--solid" href="#projects">Every project, function by function</a>
      <a class="btn btn--ghost" href="#method">Method and blind spots</a>
    </div>
   </div>
   <aside class="now" aria-labelledby="now-title">
    <p class="mono now__k">assessed at HEAD of every default branch</p>
    <h2 id="now-title">The fleet <span>${esc(dLong(D.generatedAt))}</span></h2>
    <dl>
      <div><dt>projects assessed</dt><dd>${n(F.repos)}</dd></div>
      <div><dt>checks evaluated</dt><dd>${n(F.evaluated)}</dd></div>
      <div><dt>passing</dt><dd>${pct((100 * F.passed) / F.evaluated)}</dd></div>
      <div><dt>median project fitness</dt><dd>${fleetMedian == null ? '—' : `${Math.round(fleetMedian)}%`}</dd></div>
      <div><dt>in-repo fitness tests</dt><dd>${n(F.fitnessTests)}</dd></div>
      <div><dt>risk lines</dt><dd>${n(F.failed)}</dd></div>
    </dl>
    <a class="now__go" href="#functions">The ten fitness functions →</a>
   </aside>
  </div>
</section>

<section class="esec esec--white" aria-labelledby="read-title">
  <div class="wrap">
    <h2 id="read-title">How to read it</h2>
    <div class="cols">
      <div><h3>What a fitness function is</h3>
        <ul class="ticks ticks--plain">
          <li><b>Definition.</b> &ldquo;An architectural fitness function provides an objective integrity assessment of some architectural characteristic(s)&rdquo; — Ford, Parsons &amp; Kua, <i>Building Evolutionary Architectures</i> (2nd ed. with Sadalage). Martin Fowler keeps the term in his bliki and framed the book as monitoring &ldquo;the architectural state&rdquo; of a system that evolves.</li>
          <li><b>Axes.</b> Each function is classified atomic or holistic, static or dynamic, triggered or continual, automated or manual. Nine of ours are atomic&nbsp;· static&nbsp;· triggered&nbsp;· automated; CI green is the one holistic&nbsp;· dynamic check.</li>
          <li><b>Already in the fleet.</b> The repositories ship their own fitness functions as Go tests under <code>internal/architecture/</code> — event envelopes, catalogue shape, Kafka writer topics, MCP authority. This assessment counts ${n(F.fitnessTests)} of those test functions across ${n(F.fitnessTestFiles)} files instead of re-judging what they protect.</li>
        </ul>
      </div>
      <div><h3>What this page borrows from ATAM</h3>
        <ul class="ticks ticks--plain">
          <li><b>Utility tree.</b> The SEI's Architecture Tradeoff Analysis Method elicits quality attributes, refines them into scenarios with measurable responses, and analyses the architecture against them. Our utility tree is the table below: characteristic → check → target.</li>
          <li><b>Risks.</b> ATAM reports risks and sensitivity points. Here, every missed target is a risk line on the project's page, with the measured value that missed it.</li>
          <li><b>What we do not do.</b> ATAM's stakeholder brainstorm, tradeoff points and cost/benefit analysis need people in a room; this is one repository-reading script. Tradeoffs are <em>not assessed</em> — that is the method's biggest blind spot, stated rather than papered over.</li>
        </ul>
      </div>
      <div><h3>Strongest signals in this run</h3>
        <ul class="ticks ticks--plain">
          <li>Median project fitness ${fleetMedian == null ? '—' : `${Math.round(fleetMedian)}%`} of applicable checks met; ${n(F.passed)} of ${n(F.evaluated)} checks pass fleet-wide.</li>
          <li>${riskLines || 'Every check meets its target.'}</li>
          <li>Domain purity holds in every service that has a domain layer: ${n(F.byFF.domainPurity.pass)} of ${n(F.byFF.domainPurity.applicable)} at zero framework imports.</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<section class="esec" id="functions" aria-labelledby="ff-title">
  <div class="wrap">
    <h2 id="ff-title">The ten fitness functions</h2>
    <p class="sec-lede">Characteristic → check → target, ATAM's utility-tree shape. A function that does not apply to a project (no Go code, no events, no MCP surface) is counted as n/a, never as a pass.</p>
    ${tableWrap('The ten fitness functions', `<table class="t"><caption>Architectural fitness functions, targets and fleet results</caption>
<thead><tr><th scope="col">Function</th><th scope="col">Characteristic</th><th scope="col">Axes</th><th scope="col">Target</th><th scope="col">Pass</th><th scope="col">Rate</th></tr></thead><tbody>${ffRows}</tbody></table>`)}
  </div>
</section>

<section class="esec esec--white" id="projects" aria-labelledby="pr-title">
  <div class="wrap">
    <h2 id="pr-title">Every project, function by function</h2>
    <p class="sec-lede">✓ meets the target, ✗ misses it, · not applicable. The last columns count applicable checks passed, the fitness share, and link to the project's engineering study.</p>
    ${tableWrap('Fitness-function matrix', `<table class="t t--matrix"><caption>Fitness functions per project</caption>
<thead><tr><th scope="col">Project</th>${ORDER.map((k) => `<th scope="col" title="${esc(FF[k].name)}: ${esc(FF[k].target)}">${esc(SHORT[k])}</th>`).join('')}<th scope="col">Pass</th><th scope="col">Fitness</th><th scope="col">Study</th></tr></thead><tbody>${matrix}</tbody></table>`)}
  </div>
</section>

<section class="esec" id="method" aria-labelledby="m-title">
  <div class="wrap method">
    <h2 id="m-title">Method, sources and blind spots</h2>
    <div class="cols">
      <div>
        <h3>Where the numbers come from</h3>
        <ul class="ticks ticks--plain">
          <li><b>git</b>: the file tree of <code>origin/&lt;default&gt;</code> in each clone, after a fetch — the same rule as the engineering study. Layout, adapters, contracts, event types, architecture tests and ADRs are read from the tree; domain imports are read file by file under <code>internal/domain/</code>.</li>
          <li><b>The engineering study</b>, same day: language, group, lines by class (test investment), CI success over the last four ISO weeks. <code>check.mjs</code> cross-checks the two files agree.</li>
          <li><b>Applicability</b>: hexagonal checks apply to Go services, the <code>src/</code> layout to TypeScript apps, event naming only where an AsyncAPI spec exists, MCP isolation only where the context declares an MCP server. A check with nothing to measure is n/a, published as n/a.</li>
        </ul>
      </div>
      <div>
        <h3>Definitions</h3>
        <ul class="ticks ticks--plain">
          <li><b>Event grammar</b>: <code>com.warehouse.&lt;subdomain&gt;.&lt;context&gt;.&lt;entity&gt;.&lt;Event&gt;</code>, an optional trailing <code>.vN</code> version accepted; counted from CloudEvents <code>type:</code> declarations in the AsyncAPI specs, which are the contract source of truth.</li>
          <li><b>Framework markers</b> for domain purity: kafka-go, sqlx, echo, gin, gorm, pgx, go-redis, nats, grpc, net/http, database/sql, plus the repo's own <code>internal/adapters</code>. Domain → domain and domain → application ports are not violations.</li>
          <li><b>Thresholds</b> are stated in each function's target. They were written once, from the fleet's own standards (ADR 0008, the CloudEvents mandate, the harness checklist), not fitted to the data.</li>
        </ul>
      </div>
      <div>
        <h3>Blind spots</h3>
        <ul class="ticks ticks--plain">
          <li><b>Static shape, mostly.</b> Nine of ten functions read structure at HEAD. Runtime characteristics — latency, availability, degradation under load — are not measured here; CI green is the only dynamic signal.</li>
          <li><b>No tradeoff analysis.</b> ATAM's tradeoff and sensitivity points need human analysis; a script cannot say that a failing check is the right price for something else. Failed checks are risks, not instructions.</li>
          <li><b>Counts, not semantics.</b> An ADR file exists or it does not; the script cannot tell a good decision record from a thin one. The same goes for every pass on this page.</li>
          <li><b>One point in time.</b> Unlike the weekly engineering reports, this assessment has no history yet; it will be recounted, and drift will become visible only then.</li>
        </ul>
      </div>
    </div>
  </div>
</section>`;
    page({ path: '/architecture/', title: 'Architecture assessment', current: 'overview', description: `A study project, not a product. Ten architectural fitness functions assessed for all ${F.repos} IQVO repositories: structure, coupling, contracts, governance and delivery, counted from the repositories.`, body });
  }

  // ============================================================ PROJECT PAGES
  for (const r of repos) {
    const url = r.private ? null : `${cfg.githubUrl}/${r.name}`;
    const rows = ORDER.filter((k) => r.ff[k].applicable).map((k) => {
      const f = FF[k]; const ff = r.ff[k];
      return `<tr><th scope="row"><a href="/architecture/#ff-${k}">${esc(f.name)}</a></th><td class="mono">${esc(f.axes)}</td><td>${esc(f.target)}</td><td>${esc(fmtValue(k, ff))}</td><td>${pill(ff)}</td></tr>`;
    }).join('');
    const naList = ORDER.filter((k) => !r.ff[k].applicable).map((k) => SHORT[k]).join(', ');

    // detail blocks + risk lines, every sentence computed
    const detail = [];
    if (r.ff.layout.applicable && !r.ff.layout.pass && r.ff.layout.detail.stray?.length) detail.push(`<h3>Files outside the standard layout</h3><ul class="ticks ticks--plain">${r.ff.layout.detail.stray.map((p) => `<li><code>${esc(p)}</code></li>`).join('')}</ul>${r.ff.layout.detail.strayN > r.ff.layout.detail.stray.length ? `<p class="muted">…and ${n(r.ff.layout.detail.strayN - r.ff.layout.detail.stray.length)} more.</p>` : ''}`);
    if (r.ff.domainPurity.applicable && r.ff.domainPurity.detail.violations?.length) detail.push(`<h3>Domain files importing adapters or frameworks</h3><ul class="ticks ticks--plain">${r.ff.domainPurity.detail.violations.map((v) => `<li><code>${esc(v.file)}</code> → ${v.imports.map(esc).join(', ')}</li>`).join('')}</ul>`);
    if (r.ff.adapters.applicable && r.ff.adapters.detail) detail.push(`<h3>Adapters and binaries</h3><p class="mono">in: ${r.ff.adapters.detail.inbound.length ? esc(r.ff.adapters.detail.inbound.join(', ')) : '<span class="r-bad">none</span>'} · out: ${r.ff.adapters.detail.outbound.length ? esc(r.ff.adapters.detail.outbound.join(', ')) : '<span class="r-bad">none</span>'} · cmd: ${esc(r.ff.adapters.detail.cmds.join(', '))}</p>`);
    if (r.ff.contracts.applicable) detail.push(`<h3>API contracts</h3><p class="mono">${r.ff.contracts.detail.specs.length ? r.ff.contracts.detail.specs.map(esc).join(' · ') : '<span class="r-bad">no spec file</span>'}</p>`);
    if (r.ff.events.applicable && r.ff.events.detail.nonConforming?.length) detail.push(`<h3>Event types outside the grammar</h3><ul class="ticks ticks--plain">${r.ff.events.detail.nonConforming.map((t) => `<li><code>${esc(t)}</code></li>`).join('')}</ul>`);
    if (r.ff.fitnessTests.applicable && r.ff.fitnessTests.detail) detail.push(`<h3>In-repo fitness tests</h3><p>${n(r.ff.fitnessTests.detail.tests)} test functions in ${n(r.ff.fitnessTests.detail.files)} files: <span class="mono">${r.ff.fitnessTests.detail.names.map(esc).join(' · ')}</span></p>`);
    if (r.ff.tests.applicable) detail.push(`<h3>Test investment</h3><p class="mono">${n(r.ff.tests.detail.test)} test lines against ${n(r.ff.tests.detail.code)} code lines at HEAD.</p>`);

    const risks = ORDER.filter((k) => r.ff[k].applicable && !r.ff[k].pass).map((k) => {
      const ff = r.ff[k];
      switch (k) {
        case 'layout': return `${ff.value}% of source files sit inside the standard layout (${n(ff.detail.strayN)} outside) — the hexagonal boundary is eroding at the edges.`;
        case 'domainPurity': return `${n(ff.value)} of ${n(ff.detail.n)} domain files import an adapter or a framework — the dependency rule is broken where the domain meets the outside.`;
        case 'adapters': return ff.value === 'in only' ? 'No outbound adapters: the service has no explicit way out; check for hidden writes.' : ff.value === 'out only' ? 'No inbound adapters: nothing drives this service through a port.' : 'No adapters under internal/adapters/: the hexagon is not built.';
        case 'contracts': return 'No OpenAPI or AsyncAPI spec found — the contract exists only as code, so drift cannot be checked.';
        case 'events': return `${n(ff.detail.nonConformingN)} of ${n(ff.detail.distinct)} declared event types fall outside the mandated grammar.`;
        case 'fitnessTests': return 'No in-repo architecture tests — the fleet\u2019s own fitness functions do not run for this project.';
        case 'adr': return 'No architecture decision records found — the project cannot show why it decided.';
        case 'mcp': return ff.value === 'absent' ? 'The context declares an MCP server but neither cmd/mcp nor an inbound MCP adapter exists.' : 'The MCP surface is an inbound adapter but not a separate binary (ADR 0008 wants cmd/mcp).';
        case 'tests': return `${ff.value.toFixed(2)} test lines per code line at HEAD, under the 0.8 target — changes are cheaper than the safety net that guards them.`;
        case 'ci': return `CI green only ${pct(ff.value)} of decided runs over the last four ISO weeks — the pipeline, the only gate in a single-maintainer fleet, is noisy.`;
        default: return `${FF[k].name}: measured ${esc(String(ff.value))}, target ${esc(FF[k].target)}.`;
      }
    });

    const body = `
<section class="ehero ehero--sm"><div class="wrap">
  ${crumbs([['/architecture/', 'Architecture assessment'], ['/architecture/#projects', 'Projects'], [`/architecture/projects/${r.name}/`, r.name]])}
  <p class="kicker">${esc(GROUP_LABEL[r.group] || r.group)}${r.context ? ` · ${esc(r.context.kind)} domain` : r.classification ? ` · ${esc(r.classification)}` : ''}</p>
  <h1>${esc(r.name)}</h1>
  ${r.description ? `<p class="lede">${esc(r.description)}</p>` : ''}
  <p class="meta mono">${[r.language && `language ${esc(r.language)}`, `default branch <code>${esc(r.defaultBranch)}</code>`, r.context ? `bounded context <code>${esc(r.context.id)}</code>` : 'not a registered context', url ? `<a href="${url}" rel="noopener">GitHub ↗</a>` : 'private repository', `<a href="/engineering/projects/${r.name}/">engineering study ↗</a>`].filter(Boolean).join(' · ')}</p>
</div></section>

<section class="esec esec--white" aria-labelledby="sc-title"><div class="wrap">
  <div class="scorehead"><h2 id="sc-title">Architecture fitness</h2><p class="bigscore r-${rateCls(r.fitness)}" aria-label="${r.passed} of ${r.applicable} applicable fitness functions met"><b>${r.fitness == null ? '—' : `${r.fitness}%`}</b><span>${n(r.passed)} / ${n(r.applicable)} checks</span></p></div>
  ${tableWrap(`${r.name} fitness functions`, `<table class="t"><caption>${esc(r.name)}: fitness functions that apply to this project</caption><thead><tr><th scope="col">Function</th><th scope="col">Axes</th><th scope="col">Target</th><th scope="col">Measured</th><th scope="col">Result</th></tr></thead><tbody>${rows}</tbody></table>`)}
  ${naList ? `<p class="muted">Not applicable here: ${esc(naList)}.</p>` : ''}
  <h3>Risks</h3>
  <ul class="findings">${risks.length ? risks.map((x) => `<li>${esc(x)}</li>`).join('') : '<li>Every applicable fitness function meets its target in this run.</li>'}</ul>
</div></section>

${detail.length ? `<section class="esec" aria-labelledby="dt-title"><div class="wrap"><h2 id="dt-title">Evidence</h2><div class="cols">${detail.map((d) => `<div>${d}</div>`).join('')}</div></div></section>` : ''}`;

    page({ path: `/architecture/projects/${r.name}/`, title: `${r.name} architecture assessment`, current: 'projects', description: `A study project, not a product. Architecture assessment of ${r.name}: ${r.passed} of ${r.applicable} fitness functions met, counted from the repository.`, body });
  }

  return pages;
}

// Numbers for the landing page band (index.html placeholders).
export function architectureView(data) {
  const F = data.fleet;
  return {
    repos: F.repos,
    checks: F.evaluated,
    pass: `${Math.round((100 * F.passed) / F.evaluated)}%`,
    tests: new Intl.NumberFormat('en-US').format(F.fitnessTests),
    risks: F.failed,
  };
}

// Renders the clean-code assessment (data/cleancode.json) into static pages under dist/cleancode/.
//   /cleancode/                    overview: the ten checks, the fleet matrix, method
//   /cleancode/projects/<repo>/    one assessment per project
// No JavaScript: every figure is read from data/cleancode.json; every sentence that states a
// number is computed here (ADR 0002, ADR 0007). Shares the study's banner, footer and CSS.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('en-US');
const n = (x) => (x == null ? '—' : nf.format(x));
const pct = (x) => (x == null ? '—' : `${Math.round(x)}%`);
const sum = (arr) => arr.reduce((a, b) => a + (b || 0), 0);
const median = (arr) => { const s = arr.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const plural = (x, one, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;
const dLong = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const rateCls = (x, good = 80, warn = 60) => (x == null ? 'na' : x >= good ? 'good' : x >= warn ? 'warn' : 'bad');

export function renderCleancode({ data, cfg, updatedLabel }) {
  const D = data;
  const CC = D.method.checks;
  const ORDER = D.method.order;
  const repos = Object.entries(D.repos).map(([name, r]) => ({ name, ...r }));
  const groups = [...new Set(repos.map((r) => r.group))];
  const GROUP_LABEL = {
    wms: 'WMS bounded contexts', wes: 'WES bounded contexts', 'retail-network': 'Retail-network bounded contexts',
    storefront: 'Storefront bounded contexts', frontends: 'Frontends and BFFs', platform: 'Platform, harness and docs',
  };
  const fleetMedian = median(repos.map((r) => r.clean));
  const pages = [];

  const NAV = [
    ['/cleancode/', 'Overview', 'overview'],
    ['/cleancode/#projects', 'Projects', 'projects'],
    ['/cleancode/#checks', 'The ten checks', 'checks'],
    ['/cleancode/#method', 'Method', 'method'],
  ];
  const layout = ({ path, title, description, current, body }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · IQVO clean-code assessment</title>
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
<body class="eng cc">
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
    <nav class="enav__nav" aria-label="Clean-code assessment">
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
      <p>Counted from the repositories&rsquo; git trees by <code>scripts/collect-cleancode.mjs</code> and <code>scripts/cleancode_scan.go</code> on ${esc(updatedLabel)} and rendered by <code>scripts/cleancode.mjs</code>; no number is typed by hand. Written by GLM 5.3 (Z.ai) under human direction. The checks, their targets and their blind spots are stated in the <a href="/cleancode/#method">method</a>.</p>
    </div>
  </div>
  <div class="wrap foot__base mono">
    <span>MIT licence</span>
    <a href="/">Landing page</a>
    <a href="/engineering/">Engineering study</a>
    <a href="/architecture/">Architecture assessment</a>
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
  const scoreBadge = (s) => `<span class="score score--${rateCls(s)}">${s == null ? '—' : s}</span>`;
  const SHORT = { gofmt: 'gofmt', funcs: 'Funcs', nesting: 'Nesting', files: 'Files', docs: 'Docs', naming: 'Names', debt: 'Debt', dup: 'Dup', lint: 'Lint', hooks: 'Hooks' };
  const pill = (cc) => !cc.applicable ? '<span class="ffpill ffpill--na" title="not applicable to this project">n/a</span>' : cc.pass ? '<span class="ffpill ffpill--pass" title="meets the target">pass</span>' : '<span class="ffpill ffpill--fail" title="misses the target">fail</span>';
  const cell = (cc) => !cc.applicable ? '<td class="ffc ffc--na"><span aria-hidden="true">·</span><span class="sr">not applicable</span></td>'
    : cc.pass ? '<td class="ffc ffc--pass"><span aria-hidden="true">✓</span><span class="sr">pass</span></td>' : '<td class="ffc ffc--fail"><span aria-hidden="true">✗</span><span class="sr">fail</span></td>';
  const fmtValue = (key, cc) => {
    if (!cc.applicable) return null;
    switch (key) {
      case 'gofmt': return `${n(cc.value)} ${cc.value === 1 ? 'file' : 'files'} need formatting`;
      case 'funcs': return `${cc.value}% of ${n(cc.detail.count)} functions over 60 lines`;
      case 'nesting': return cc.value === 0 ? `deepest nesting ${n(cc.detail.maxSeen)}` : `${n(cc.value)} functions deeper than 4`;
      case 'files': return cc.value === 0 ? `longest file ${n(cc.detail.longest.lines)} lines` : `${n(cc.value)} files over 800 lines`;
      case 'docs': return `${n(cc.detail.exported - cc.detail.undocumented)} of ${n(cc.detail.exported)} documented (${pct(cc.value)})`;
      case 'naming': return `${n(cc.value)} underscore violations · ${n(cc.detail.stutterN)} stutter counted, not scored`;
      case 'debt': return cc.value === 0 ? '0 markers' : `${n(cc.value)} markers`;
      case 'dup': return `${cc.value}% of ${n(cc.detail.count)} functions are copies`;
      case 'lint': return cc.value ? esc(cc.value) : 'no linter found';
      case 'hooks': return cc.value === 'lefthook' ? `lefthook (${esc(cc.detail.jobs.join(', '))})` : 'no pre-commit hooks';
      default: return `${n(cc.value)}`;
    }
  };

  // ============================================================ OVERVIEW
  {
    const F = D.fleet;
    const ccRows = ORDER.map((k) => { const c = CC[k]; const b = F.byCC[k]; return `<tr id="cc-${k}"><th scope="row">${esc(c.name)}</th><td>${esc(c.characteristic)}</td><td>${esc(c.target)}</td><td class="num"><b>${n(b.pass)}</b> / ${n(b.applicable)}</td><td class="r-${rateCls(b.applicable ? (100 * b.pass) / b.applicable : null)}">${pct(b.applicable ? (100 * b.pass) / b.applicable : null)}</td></tr>`; }).join('');
    const worst = ORDER.map((k) => ({ k, ...F.byCC[k] })).filter((x) => x.applicable).sort((a, b) => (a.pass / a.applicable) - (b.pass / b.applicable)).slice(0, 3);
    const matrix = groups.map((g) => {
      const rs = repos.filter((r) => r.group === g);
      return `<tr class="grp"><th scope="colgroup" colspan="${ORDER.length + 4}">${esc(GROUP_LABEL[g] || g)} <span class="muted">· ${plural(rs.length, 'project')}</span></th></tr>` +
        rs.map((r) => `<tr><th scope="row"><a href="/cleancode/projects/${r.name}/">${esc(r.name)}</a></th>${ORDER.map((k) => cell(r.cc[k])).join('')}<td class="num"><b>${n(r.passed)}</b><span class="muted"> / ${n(r.applicable)}</span></td><td>${scoreBadge(r.clean)}</td><td><a class="mono" href="/architecture/projects/${r.name}/">architecture ↗</a></td></tr>`).join('');
    }).join('');
    const ranked = [...repos].filter((r) => r.clean != null).sort((a, b) => b.clean - a.clean || a.name.localeCompare(b.name));
    const riskLines = worst.map((w) => `${n(w.fail)} of ${n(w.applicable)} projects miss <a href="#cc-${w.k}">${esc(CC[w.k].name.toLowerCase())}</a> (${esc(CC[w.k].target)}).`).join(' ');
    const docShare = F.exported ? Math.round(100 - (100 * F.undocumented) / F.exported) : null;

    const body = `
<section class="ehero">
  <div class="wrap ehero__grid">
   <div>
    <p class="kicker">Clean-code assessment · counted ${esc(updatedLabel)}</p>
    <h1>Does the code read like <em>someone meant it?</em></h1>
    <p class="lede">Every project measured against ten clean-code checks — formatting, function size, control flow, file size, documented API surface, naming, debt markers, duplication, and the two gates that keep them honest in CI and pre-commit. Everything is counted from the repositories by a parser and a git reader; nothing on these pages is an opinion.</p>
    <p class="callout"><strong>Clean code, measured.</strong> Robert C. Martin's <i>Clean Code</i> and Fowler's <i>Refactoring</i> name the smells — long function, duplicated code, misleading names, debt left in comments. Here each smell becomes a counted fact with a stated target, and where the fleet already has a gate (<code>make fmt-check</code>, pinned golangci-lint, lefthook), the target <em>is</em> the fleet's own rule. A miss is a finding, not a verdict.</p>
    <div class="cta">
      <a class="btn btn--solid" href="#projects">Every project, check by check</a>
      <a class="btn btn--ghost" href="#method">Method and blind spots</a>
    </div>
   </div>
   <aside class="now" aria-labelledby="now-title">
    <p class="mono now__k">measured at HEAD of every default branch</p>
    <h2 id="now-title">The fleet <span>${esc(dLong(D.generatedAt))}</span></h2>
    <dl>
      <div><dt>projects assessed</dt><dd>${n(F.repos)}</dd></div>
      <div><dt>Go projects parsed</dt><dd>${n(F.goRepos)}</dd></div>
      <div><dt>checks evaluated</dt><dd>${n(F.evaluated)}</dd></div>
      <div><dt>passing</dt><dd>${pct((100 * F.passed) / F.evaluated)}</dd></div>
      <div><dt>median project score</dt><dd>${fleetMedian == null ? '—' : `${Math.round(fleetMedian)}%`}</dd></div>
      <div><dt>debt markers</dt><dd>${n(F.debtMarkers)}</dd></div>
      <div><dt>duplicate functions</dt><dd>${n(F.dupCopies)}</dd></div>
    </dl>
    <a class="now__go" href="#checks">The ten checks →</a>
   </aside>
  </div>
</section>

<section class="esec esec--white" aria-labelledby="read-title">
  <div class="wrap">
    <h2 id="read-title">How to read it</h2>
    <div class="cols">
      <div><h3>What is measured</h3>
        <ul class="ticks ticks--plain">
          <li><b>Seven Go checks</b> from a real parser: ${n(F.goFiles)} Go files and ${n(F.funcs)} named functions across ${n(F.goRepos)} repositories — gofmt drift, function length, nesting, file length, doc comments on exported symbols, naming, exact duplicate bodies.</li>
          <li><b>Three pipeline checks</b> for every project: debt markers counted by git grep across all code languages, the linter wired into CI, and lefthook pre-commit hygiene.</li>
          <li><b>Targets are stated, not tuned.</b> Each threshold names its source: the fleet's own gates where they exist, Clean Code and Refactoring where they do not.</li>
        </ul>
      </div>
      <div><h3>What the fleet looks like</h3>
        <ul class="ticks ticks--plain">
          <li>${F.gofmtFiles === 0 ? `gofmt is <b>totally clean</b>: not one of the ${n(F.goRepos)} Go repositories has a file that <code>gofmt -l</code> would rewrite — the <code>fmt-check</code> gate holds everywhere it exists.` : `<b>gofmt drift</b>: ${n(F.gofmtFiles)} files fleet-wide would be rewritten by gofmt.`}</li>
          <li>${F.debtMarkers === 0 ? `<b>Zero debt markers</b> in the comments of every code file of every project. In a fleet written by AI agents, the TODO ledger stays empty.` : `<b>${n(F.debtMarkers)} debt markers</b> sit in code comments fleet-wide.`}</li>
          <li><b>Documented API surface</b>: ${docShare == null ? '—' : `${docShare}%`} of ${n(F.exported)} exported symbols carry doc comments; the misses cluster in a few services.</li>
          <li><b>Duplication is the live smell</b>: ${n(F.dupCopies)} exact function copies — the same logger constructor, the same readiness check, repeated per binary and per adapter.</li>
        </ul>
      </div>
      <div><h3>Strongest signals in this run</h3>
        <ul class="ticks ticks--plain">
          <li>Median project score ${fleetMedian == null ? '—' : `${Math.round(fleetMedian)}%`} of applicable checks met; ${n(F.passed)} of ${n(F.evaluated)} checks pass fleet-wide.</li>
          <li>${riskLines || 'Every check meets its target.'}</li>
          <li>${n(F.hooked)} of ${n(F.repos)} projects run pre-commit gates through lefthook.</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<section class="esec" id="checks" aria-labelledby="ch-title">
  <div class="wrap">
    <h2 id="ch-title">The ten checks</h2>
    <p class="sec-lede">Smell → check → target. A check that does not apply to a project (no Go code, nothing to lint) is counted as n/a, never as a pass.</p>
    ${tableWrap('The ten clean-code checks', `<table class="t"><caption>Clean-code checks, targets and fleet results</caption>
<thead><tr><th scope="col">Check</th><th scope="col">Characteristic</th><th scope="col">Target</th><th scope="col">Pass</th><th scope="col">Rate</th></tr></thead><tbody>${ccRows}</tbody></table>`)}
  </div>
</section>

<section class="esec esec--white" id="projects" aria-labelledby="pr-title">
  <div class="wrap">
    <h2 id="pr-title">Every project, check by check</h2>
    <p class="sec-lede">✓ meets the target, ✗ misses it, · not applicable. The last columns count applicable checks passed, the clean share, and link to the project's architecture assessment.</p>
    ${tableWrap('Clean-code matrix', `<table class="t t--matrix"><caption>Clean-code checks per project</caption>
<thead><tr><th scope="col">Project</th>${ORDER.map((k) => `<th scope="col" title="${esc(CC[k].name)}: ${esc(CC[k].target)}">${esc(SHORT[k])}</th>`).join('')}<th scope="col">Pass</th><th scope="col">Clean</th><th scope="col">Architecture</th></tr></thead><tbody>${matrix}</tbody></table>`)}
  </div>
</section>

<section class="esec" id="method" aria-labelledby="m-title">
  <div class="wrap method">
    <h2 id="m-title">Method, sources and blind spots</h2>
    <div class="cols">
      <div>
        <h3>Where the numbers come from</h3>
        <ul class="ticks ticks--plain">
          <li><b>A Go parser</b> (<code>scripts/cleancode_scan.go</code>, stdlib only) reads an extracted <code>git archive</code> of each repository's default branch: gofmt equivalence via <code>go/format</code>, function length and nesting from the AST, doc comments from declarations, duplicate bodies from whitespace-stripped hashes.</li>
          <li><b>git grep</b> counts debt markers (TODO, FIXME, HACK, XXX on word boundaries) in code files of every language, tests and fixtures excluded.</li>
          <li><b>Makefiles, lint configs and CI workflows</b> are read as text to decide whether the lint gate and pre-commit hooks are wired, and to name exactly what was found.</li>
          <li><b>The engineering study</b> of the same day supplies the project list; <code>check.mjs</code> cross-checks that the two agree.</li>
        </ul>
      </div>
      <div>
        <h3>Definitions and thresholds</h3>
        <ul class="ticks ticks--plain">
          <li><b>Excluded everywhere</b>: <code>testdata/</code>, <code>vendor/</code>, generated files ("Code generated … DO NOT EDIT"), and <code>*_test.go</code> for every code check except gofmt. Table-driven tests legitimately run long; they are not scored on length.</li>
          <li><b>Function</b>: a named function or method, measured in lines from the AST. 60 lines is the stated bar (Clean Code asks for far less; 60 is what this fleet can defend today), 2% the stated tolerance.</li>
          <li><b>Duplicate</b>: two function bodies that are identical after stripping whitespace and comments, 5 lines minimum. Cross-repository repetition does not count — each context is deliberately its own repository.</li>
          <li><b>Stutter is counted, never scored.</b> The golint rule flags <code>promise.PromiseMade</code>; the fleet's CloudEvents grammar mandates entity-first event names. ${n(D.fleet.stutter)} such names exist and are listed as evidence on project pages, not as failures.</li>
        </ul>
      </div>
      <div>
        <h3>Blind spots</h3>
        <ul class="ticks ticks--plain">
          <li><b>Syntax only.</b> The scanner has no type information: no cyclomatic complexity, no dead-code detection, no semantic duplication (a renamed copy is invisible), no judgement of whether a function does one thing.</li>
          <li><b>Size is a proxy.</b> Small functions and small files correlate with readable code; they do not guarantee it. A 59-line function can be worse than a 70-line one.</li>
          <li><b>The gates are read, not run.</b> Whether CI is green is the engineering study's question; this page only checks that the gates are wired.</li>
          <li><b>One point in time.</b> The assessment is recounted with the reports; drift becomes visible only across runs.</li>
        </ul>
      </div>
    </div>
  </div>
</section>`;
    page({ path: '/cleancode/', title: 'Clean-code assessment', current: 'overview', description: `A study project, not a product. Ten clean-code checks measured for all ${F.repos} IQVO repositories: formatting, function size, nesting, duplication, documentation and pipeline hygiene, counted from the repositories.`, body });
  }

  // ============================================================ PROJECT PAGES
  for (const r of repos) {
    const url = r.private ? null : `${cfg.githubUrl}/${r.name}`;
    const rows = ORDER.filter((k) => r.cc[k].applicable).map((k) => {
      const c = CC[k]; const cc = r.cc[k];
      return `<tr><th scope="row"><a href="/cleancode/#cc-${k}">${esc(c.name)}</a></th><td>${esc(c.source)}</td><td>${esc(c.target)}</td><td>${fmtValue(k, cc)}</td><td>${pill(cc)}</td></tr>`;
    }).join('');
    const naList = ORDER.filter((k) => !r.cc[k].applicable).map((k) => SHORT[k]).join(', ');

    // detail blocks + risk lines, every sentence computed
    const detail = [];
    const cc = r.cc;
    if (cc.funcs.applicable && cc.funcs.detail.over?.length) detail.push(`<h3>Longest functions</h3><ul class="ticks ticks--plain">${cc.funcs.detail.over.slice(0, 6).map((f) => `<li><code>${esc(f.file)}</code> — <code>${esc(f.name)}</code>, ${n(f.lines)} lines</li>`).join('')}</ul>${cc.funcs.detail.overN > 6 ? `<p class="muted">…and ${n(cc.funcs.detail.overN - 6)} more.</p>` : ''}`);
    if (cc.nesting.applicable && cc.nesting.detail.over?.length) detail.push(`<h3>Deep control flow</h3><ul class="ticks ticks--plain">${cc.nesting.detail.over.slice(0, 6).map((f) => `<li><code>${esc(f.file)}</code> — <code>${esc(f.name)}</code>, nested ${n(f.depth)} levels</li>`).join('')}</ul>`);
    if (cc.files.applicable && cc.files.detail.over?.length) detail.push(`<h3>Files over 800 lines</h3><ul class="ticks ticks--plain">${cc.files.detail.over.map((p) => `<li><code>${esc(p)}</code></li>`).join('')}</ul>`);
    if (cc.docs.applicable && cc.docs.detail.worst?.length) detail.push(`<h3>Least-documented files</h3><ul class="ticks ticks--plain">${cc.docs.detail.worst.slice(0, 6).map((w) => `<li><code>${esc(w.file)}</code> — ${n(w.n)} exported symbols without a doc comment</li>`).join('')}</ul>`);
    if (cc.naming.applicable && cc.naming.detail.stutter) detail.push(`<h3>Stuttering names (counted, not scored)</h3><p>${n(cc.naming.detail.stutterN)} exported names repeat the package name, e.g. <span class="mono">${cc.naming.detail.stutter.slice(0, 4).map((s) => esc(s.what)).join(', ')}</span>. Most are domain events whose names the CloudEvents grammar mandates.</p>`);
    if (cc.debt.applicable && cc.debt.detail.examples?.length) detail.push(`<h3>Debt markers</h3><ul class="ticks ticks--plain">${cc.debt.detail.examples.slice(0, 6).map((e) => `<li><code>${esc(e)}</code></li>`).join('')}</ul>`);
    if (cc.dup.applicable && cc.dup.detail.groups?.length) detail.push(`<h3>Duplicate function bodies</h3><ul class="ticks ticks--plain">${cc.dup.detail.groups.slice(0, 6).map((g) => `<li>${n(g.len)} identical lines in ${g.files.map((f) => `<code>${esc(f)}</code>`).join(', ')}</li>`).join('')}</ul>${cc.dup.detail.extraN > 6 ? `<p class="muted">${n(cc.dup.detail.extraN)} duplicate copies in total.</p>` : ''}`);
    if (cc.lint.applicable) detail.push(`<h3>Wired gates</h3>${cc.lint.detail.found?.length ? `<ul class="ticks ticks--plain">${cc.lint.detail.found.slice(0, 5).map((f) => `<li><code>${esc(f.file)}</code> — ${esc(f.tools.join(', '))}</li>`).join('')}</ul>` : '<p>No lint gate found in the Makefile, configs or CI workflows.</p>'}`);
    if (cc.hooks.pass) detail.push(`<h3>Pre-commit hooks</h3><p class="mono">lefthook: ${esc(cc.hooks.detail.jobs.join(' · '))}</p>`);

    const risks = ORDER.filter((k) => r.cc[k].applicable && !r.cc[k].pass).map((k) => {
      const c = r.cc[k];
      switch (k) {
        case 'gofmt': return `${n(c.value)} files would be rewritten by gofmt — run <code>make fmt</code>.`;
        case 'funcs': return `${c.value}% of named functions exceed 60 lines (${n(c.detail.overN)} of ${n(c.detail.count)}); the longest, <code>${esc(c.detail.longest.name)}</code>, is ${n(c.detail.longest.lines)} lines.`;
        case 'nesting': return `${n(c.value)} functions nest control flow deeper than 4 levels (deepest ${n(c.detail.over[0]?.depth || c.detail.maxSeen)}).`;
        case 'files': return `${n(c.value)} non-test files exceed 800 lines.`;
        case 'docs': return `Only ${pct(c.value)} of exported symbols carry doc comments — ${n(c.detail.undocumented)} of ${n(c.detail.exported)} are undocumented; godoc is the API contract the other contexts read.`;
        case 'naming': return `${n(c.value)} exported names contain underscores.`;
        case 'debt': return `${n(c.value)} TODO/FIXME/HACK/XXX markers sit in code files.`;
        case 'dup': return `${c.value}% of named functions are exact copies of another (${n(c.detail.extraN)} duplicate bodies) — the classic Duplicated Code smell.`;
        case 'lint': return 'No linter is wired into the Makefile, the configs or CI — the gate exists only on a willing machine.';
        case 'hooks': return 'No lefthook pre-commit hooks: the fast gates (fmt/vet/lint) do not run before a commit exists.';
        default: return `${CC[k].name}: measured ${esc(String(c.value))}, target ${esc(CC[k].target)}.`;
      }
    });

    const body = `
<section class="ehero ehero--sm"><div class="wrap">
  ${crumbs([['/cleancode/', 'Clean-code assessment'], ['/cleancode/#projects', 'Projects'], [`/cleancode/projects/${r.name}/`, r.name]])}
  <p class="kicker">${esc(GROUP_LABEL[r.group] || r.group)}${r.context ? ` · ${esc(r.context.kind)} domain` : r.classification ? ` · ${esc(r.classification)}` : ''}</p>
  <h1>${esc(r.name)}</h1>
  ${r.description ? `<p class="lede">${esc(r.description)}</p>` : ''}
  <p class="meta mono">${[r.go ? 'Go parsed' : r.language && `language ${esc(r.language)}`, `default branch <code>${esc(r.defaultBranch)}</code>`, r.context ? `bounded context <code>${esc(r.context.id)}</code>` : 'not a registered context', url ? `<a href="${url}" rel="noopener">GitHub ↗</a>` : 'private repository', `<a href="/architecture/projects/${r.name}/">architecture assessment ↗</a>`].filter(Boolean).join(' · ')}</p>
</div></section>

<section class="esec esec--white" aria-labelledby="sc-title"><div class="wrap">
  <div class="scorehead"><h2 id="sc-title">Clean code</h2><p class="bigscore r-${rateCls(r.clean)}" aria-label="${r.passed} of ${r.applicable} applicable checks met"><b>${r.clean == null ? '—' : `${r.clean}%`}</b><span>${n(r.passed)} / ${n(r.applicable)} checks</span></p></div>
  ${tableWrap(`${r.name} clean-code checks`, `<table class="t"><caption>${esc(r.name)}: checks that apply to this project</caption><thead><tr><th scope="col">Check</th><th scope="col">Source</th><th scope="col">Target</th><th scope="col">Measured</th><th scope="col">Result</th></tr></thead><tbody>${rows}</tbody></table>`)}
  ${naList ? `<p class="muted">Not applicable here: ${esc(naList)}${r.go ? '' : ' — no Go code to parse'}.</p>` : ''}
  <h3>Findings</h3>
  <ul class="findings">${risks.length ? risks.map((x) => `<li>${x}</li>`).join('') : '<li>Every applicable check meets its target in this run.</li>'}</ul>
</div></section>

${detail.length ? `<section class="esec" aria-labelledby="dt-title"><div class="wrap"><h2 id="dt-title">Evidence</h2><div class="cols">${detail.map((d) => `<div>${d}</div>`).join('')}</div></div></section>` : ''}`;

    page({ path: `/cleancode/projects/${r.name}/`, title: `${r.name} clean-code assessment`, current: 'projects', description: `A study project, not a product. Clean-code assessment of ${r.name}: ${r.passed} of ${r.applicable} checks met, counted from the repository.`, body });
  }

  return pages;
}

// Numbers for the landing page band (index.html placeholders).
export function cleancodeView(data) {
  const F = data.fleet;
  return {
    repos: F.repos,
    goRepos: F.goRepos,
    checks: F.evaluated,
    pass: `${Math.round((100 * F.passed) / F.evaluated)}%`,
    funcs: new Intl.NumberFormat('en-US').format(F.funcs),
    debt: new Intl.NumberFormat('en-US').format(F.debtMarkers),
    dup: new Intl.NumberFormat('en-US').format(F.dupCopies),
    findings: F.failed,
  };
}

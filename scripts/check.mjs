#!/usr/bin/env node
// Static sanity gate for dist/. Fails the build on a broken link, a missing alt,
// an external resource, an unresolved placeholder, inconsistent counts or a blown size budget.
//   node scripts/check.mjs            # offline checks (used by the Dockerfile)
//   node scripts/check.mjs --online   # also HEAD every external link (needs network)

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const online = process.argv.includes('--online');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const facts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'facts.json'), 'utf8'));
const docsHost = new URL(process.env.DOCS_URL || cfg.docsUrl).host;
const ghHost = new URL(cfg.githubUrl).host;
const siteUrl = (process.env.SITE_URL || cfg.siteUrl || '').replace(/\/+$/, '');
const siteHost = siteUrl ? new URL(siteUrl).host : null;

const eng = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'engineering.json'), 'utf8'));
const arch = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'architecture.json'), 'utf8'));
const brief = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'briefings.json'), 'utf8'));
const es = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'eventstorming.json'), 'utf8'));
const errors = [];
const fail = (m) => errors.push(m);
const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const read = (f) => fs.readFileSync(path.join(DIST, f), 'utf8');
const exists = (p) => fs.existsSync(path.join(DIST, p));
// a local URL path -> the file nginx serves for it (`try_files $uri $uri/` + `index index.html`)
const fileFor = (p) => { const rel = p.replace(/^\//, ''); if (rel === '' || rel.endsWith('/')) return `${rel}index.html`; return fs.existsSync(path.join(DIST, rel)) && fs.statSync(path.join(DIST, rel)).isDirectory() ? `${rel}/index.html` : rel; };
const idsOf = new Map();
const idsIn = (f) => { if (!idsOf.has(f)) idsOf.set(f, new Set([...read(f).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))); return idsOf.get(f); };
const walkAll = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkAll(path.join(d, e.name)) : [path.join(d, e.name)]));
const DISC = "This project is a domain-driven design study. It is not associated with, endorsed by or affiliated with any company, and it uses no company's code, data, logos or trademarks. All names, figures and examples are illustrative or synthetic.";
const engPages = walkAll(path.join(DIST, 'engineering')).filter((f) => f.endsWith('.html')).map((f) => path.relative(DIST, f).split(path.sep).join('/'));
const archPages = walkAll(path.join(DIST, 'architecture')).filter((f) => f.endsWith('.html')).map((f) => path.relative(DIST, f).split(path.sep).join('/'));
const briefPages = walkAll(path.join(DIST, 'briefings')).filter((f) => f.endsWith('.html')).map((f) => path.relative(DIST, f).split(path.sep).join('/'));
const esPages = walkAll(path.join(DIST, 'eventstorming')).filter((f) => f.endsWith('.html')).map((f) => path.relative(DIST, f).split(path.sep).join('/'));

for (const page of ['index.html', '404.html', ...engPages, ...archPages, ...briefPages, ...esPages]) {
  if (!exists(page)) { fail(`${page} missing from dist/`); continue; }
  const html = read(page);

  if (/\{\{[^}]*\}\}/.test(html)) fail(`${page}: unresolved placeholder ${html.match(/\{\{[^}]*\}\}/)[0]}`);

  // ---- links and resources ----
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const idList = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  idList.forEach((id, i) => { if (idList.indexOf(id) !== i) fail(`${page}: duplicate id "${id}"`); });
  const externals = new Set();
  for (const m of html.matchAll(/\s(href|src)="([^"]*)"/g)) {
    const [, attr, v] = m;
    if (v.startsWith('#')) { if (v.length > 1 && !ids.has(v.slice(1))) fail(`${page}: ${attr}="${v}" has no target id`); continue; }
    if (/^https?:\/\//.test(v)) {
      const host = new URL(v).host;
      if (attr === 'src') fail(`${page}: external resource ${v} (the page must be self-contained)`);
      else if (host !== docsHost && host !== ghHost && host !== siteHost) fail(`${page}: link to unexpected host ${host}`);
      externals.add(v);
      continue;
    }
    if (/^(mailto:|data:)/.test(v)) continue;
    const [p, frag] = v.split('?')[0].split('#');
    const target = fileFor(p);
    if (!exists(target)) { fail(`${page}: ${attr}="${v}" does not exist in dist/`); continue; }
    if (frag && target.endsWith('.html') && !idsIn(target).has(frag)) fail(`${page}: ${attr}="${v}" has no target id in ${target}`);
  }
  if (/<link[^>]+rel="stylesheet"[^>]+href="https?:/.test(html)) fail(`${page}: external stylesheet`);
  if (/\sstyle="/.test(html)) fail(`${page}: inline style attribute (CSP forbids it)`);
  if (/<script(?![^>]*(type="application\/json"|src=))[^>]*>/.test(html)) fail(`${page}: inline script (CSP forbids it)`);

  // ---- a11y basics ----
  for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\salt="/.test(m[0])) fail(`${page}: <img> without alt: ${m[0].slice(0, 60)}`);
  const h1 = (html.match(/<h1[\s>]/g) || []).length;
  if (h1 !== 1) fail(`${page}: expected exactly one <h1>, found ${h1}`);
  if (!/<html lang="/.test(html)) fail(`${page}: <html lang> missing`);
  if (!/<meta name="viewport"/.test(html)) fail(`${page}: viewport meta missing`);
  for (const m of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) if (!/rel="[^"]*noopener/.test(m[0])) fail(`${page}: target=_blank without noopener`);

  if (page === 'index.html') {
    // every tab has a panel, every aria-controls/labelledby target exists
    for (const m of html.matchAll(/data-tab="([^"]+)"/g)) if (!html.includes(`data-panel="${m[1]}"`)) fail(`tab "${m[1]}" has no panel`);
    for (const m of html.matchAll(/aria-(?:controls|labelledby)="([^"]+)"/g)) for (const id of m[1].split(/\s+/)) if (!ids.has(id)) fail(`aria reference to missing id "${id}"`);

    if (siteUrl) {
      if (!html.includes(`<link rel="canonical" href="${siteUrl}/">`)) fail('canonical link missing or wrong origin');
      if (!html.includes(`<meta property="og:image" content="${siteUrl}/og-image.jpg">`)) fail('og:image missing or wrong origin');
      if (!exists('sitemap.xml') || !read('sitemap.xml').includes(`<loc>${siteUrl}/</loc>`)) fail('sitemap.xml missing or wrong origin');
      if (!read('robots.txt').includes(`Sitemap: ${siteUrl}/sitemap.xml`)) fail('robots.txt has no Sitemap line');
    }

    if (!html.includes('id="not"')) fail('"What IQVO is not" band missing');
    if (!html.includes('href="/engineering/"')) fail('landing page does not link the engineering study');
    if (!html.includes('href="/architecture/"')) fail('landing page does not link the architecture assessment');
    if (!html.includes('href="/briefings/"')) fail('landing page does not link the executive briefings');
    if (!html.includes('id="eventstorming"') || !html.includes('href="#eventstorming"')) fail('landing page has no EventStorming section or nav link');
    if (!html.includes('href="/eventstorming/#big-picture"')) fail('landing page does not link the EventStorming big picture');

    // ---- facts must be consistent with what the page says ----
    const c = facts.counts;
    const sum = Object.values(c.byDomain).reduce((a, b) => a + b, 0);
    if (sum !== c.contexts) fail(`facts: domains sum to ${sum}, contexts is ${c.contexts}`);
    const tsum = Object.values(facts.ai.coAuthorTrailers).reduce((a, b) => a + b, 0);
    if (tsum !== facts.ai.coAuthorTrailerTotal) fail('facts: trailer total does not match the per-model sum');
    const mapJson = JSON.parse(html.match(/<script type="application\/json" id="map-data">([\s\S]*?)<\/script>/)[1]);
    if (mapJson.nodes.length !== c.contexts) fail(`map: ${mapJson.nodes.length} nodes, ${c.contexts} contexts`);
    if (mapJson.edges.length !== c.eventEdges) fail(`map: ${mapJson.edges.length} edges, ${c.eventEdges} routes`);
    const dd = [...html.matchAll(/<dd>([^<]+)<\/dd>/g)].map((m) => m[1]);
    if (dd[0] !== String(c.contexts)) fail(`telemetry shows ${dd[0]} contexts, facts say ${c.contexts}`);
    if (!html.includes(new Intl.NumberFormat('en-US').format(c.commits))) fail('commit count missing from page');
    const age = (Date.now() - Date.parse(facts.generatedAt)) / 86400000;
    if (age > 45) console.warn(`warn: facts.json is ${age.toFixed(0)} days old; run \`make facts\``);
  }

  // ---- the study-project disclaimer must stay loud and verbatim on every content page ----
  if (page !== '404.html') {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/&rsquo;/g, "'").replace(/\s+/g, ' ');
    if (!text.includes(DISC)) fail(`${page}: fleet disclaimer missing or reworded in the footer`);
    if (!/<p class="banner"/.test(html)) fail(`${page}: study-project banner missing`);
    if (!text.includes('Not a product, not production, not affiliated with any company.')) fail(`${page}: banner sentence missing`);
  }

  if (online && page === 'index.html') {
    const allowedHosts = new Set([docsHost, ghHost]);
    externals.forEach((x) => { if (new URL(x).host === siteHost) externals.delete(x); }); // own origin is not live until deployed
    for (const u of externals) {
      // Only ever probe https URLs on the two hosts this page is allowed to link to.
      const target = new URL(u);
      if (target.protocol !== 'https:' || !allowedHosts.has(target.host)) { fail(`online: refusing to probe ${target.host}`); continue; }
      try {
        const r = await fetch(`${target.origin}${target.pathname}${target.search}`, { method: 'HEAD', redirect: 'follow' });
        if (!r.ok) fail(`online: ${u} -> ${r.status}`);
      } catch (e) { fail(`online: ${u} -> ${e.message}`); }
    }
    console.log(`online: checked ${externals.size} external links`);
  }
}

// ---- engineering study: complete, and its totals add up ----
{
  const repos = Object.values(eng.repos);
  const want = 2 + eng.weeks.length + repos.length;
  if (engPages.length !== want) fail(`engineering: ${engPages.length} pages, expected ${want} (overview + weekly index + ${eng.weeks.length} weeks + ${repos.length} projects)`);
  for (const w of eng.weeks) if (!exists(`engineering/weeks/${w.id}/index.html`)) fail(`engineering: report for ${w.id} missing`);
  for (const r of repos) {
    if (!exists(`engineering/projects/${r.name}/index.html`)) { fail(`engineering: study for ${r.name} missing`); continue; }
    const h1 = read(`engineering/projects/${r.name}/index.html`).match(/<h1>([^<]*)<\/h1>/);
    if (!h1 || h1[1] !== r.name) fail(`engineering: ${r.name} page has the wrong <h1>`);
  }
  if (repos.length !== eng.scope.repos) fail(`engineering: ${repos.length} repos, scope says ${eng.scope.repos}`);
  const tot = (xs, k) => xs.reduce((s, x) => s + (x?.[k] || 0), 0);
  for (const k of ['commits', 'prMerged', 'prOpened', 'runs', 'releases']) {
    const T = eng.total[k];
    if (tot(repos.map((r) => r.total), k) !== T) fail(`engineering: per-project ${k} do not sum to the fleet total ${T}`);
    if (tot(Object.values(eng.orgMonths), k) !== T) fail(`engineering: monthly ${k} do not sum to the fleet total ${T}`);
    if (tot(Object.values(eng.orgWeeks), k) !== T) fail(`engineering: weekly ${k} do not sum to the fleet total ${T}`);
    for (const r of repos) {
      if (tot(Object.values(r.months), k) !== r.total[k]) fail(`engineering: ${r.name} monthly ${k} do not sum to its total`);
      if (tot(Object.values(r.weeks), k) !== r.total[k]) fail(`engineering: ${r.name} weekly ${k} do not sum to its total`);
    }
  }
  for (const w of eng.weeks) if ((eng.weekDetail[w.id]?.merged.length || 0) !== (eng.orgWeeks[w.id]?.prMerged || 0)) fail(`engineering: ${w.id} lists ${eng.weekDetail[w.id]?.merged.length} merged PRs, counts ${eng.orgWeeks[w.id]?.prMerged}`);
  if (!read('engineering/index.html').includes(new Intl.NumberFormat('en-US').format(eng.total.commits))) fail('engineering: commit total missing from the overview');
  const age = (Date.now() - Date.parse(eng.generatedAt)) / 86400000;
  if (age > 8) console.warn(`warn: engineering.json is ${age.toFixed(0)} days old; the latest weekly report is stale (\`make engineering\`)`);
}

// ---- architecture assessment: complete, self-consistent, and consistent with the engineering data ----
{
  const repos = Object.values(arch.repos);
  const want = 1 + Object.keys(arch.repos).length;
  if (archPages.length !== want) fail(`architecture: ${archPages.length} pages, expected ${want} (overview + ${Object.keys(arch.repos).length} projects)`);
  const order = arch.method.order;
  for (const [name, r] of Object.entries(arch.repos)) {
    if (!exists(`architecture/projects/${name}/index.html`)) { fail(`architecture: assessment for ${name} missing`); continue; }
    const h1 = read(`architecture/projects/${name}/index.html`).match(/<h1>([^<]*)<\/h1>/);
    if (!h1 || h1[1] !== name) fail(`architecture: ${name} page has the wrong <h1>`);
    for (const k of order) {
      const ff = r.ff[k];
      if (ff == null) { fail(`architecture: ${name} is missing fitness function ${k}`); continue; }
      if (!ff.applicable && ff.pass !== null) fail(`architecture: ${name}.${k} is n/a but has a verdict`);
      if (ff.applicable && typeof ff.pass !== 'boolean') fail(`architecture: ${name}.${k} is applicable but has no pass/fail`);
    }
    const applicable = order.filter((k) => r.ff[k].applicable).length;
    const passed = order.filter((k) => r.ff[k].applicable && r.ff[k].pass).length;
    if (applicable !== r.applicable || passed !== r.passed || r.failed !== applicable - passed) fail(`architecture: ${name} pass/fail counts do not add up`);
    if (r.fitness !== Math.round((100 * passed) / applicable)) fail(`architecture: ${name} fitness share is wrong`);
    // cross-pipeline: shared numbers must agree with the engineering study of the same day
    const e = eng.repos[name];
    if (!e) fail(`architecture: ${name} is not in engineering.json`);
    else {
      if (r.ff.ci.applicable && r.ff.ci.value !== e.score?.ci) fail(`architecture: ${name} CI value disagrees with engineering.json`);
      if (r.ff.tests.applicable && r.ff.tests.detail.code !== e.loc?.code) fail(`architecture: ${name} code LOC disagrees with engineering.json`);
    }
  }
  for (const k of order) {
    const b = arch.fleet.byFF[k];
    let applicable = 0, pass = 0;
    for (const r of repos) { if (!r.ff[k].applicable) continue; applicable++; if (r.ff[k].pass) pass++; }
    if (applicable !== b.applicable || pass !== b.pass || b.fail !== applicable - pass) fail(`architecture: fleet roll-up for ${k} does not add up`);
  }
  if (arch.fleet.evaluated !== order.reduce((s, k) => s + arch.fleet.byFF[k].applicable, 0)) fail('architecture: fleet evaluated total is wrong');
  if (arch.fleet.passed !== order.reduce((s, k) => s + arch.fleet.byFF[k].pass, 0)) fail('architecture: fleet passed total is wrong');
  const ov = read('architecture/index.html');
  if (!ov.includes(new Intl.NumberFormat('en-US').format(arch.fleet.evaluated))) fail('architecture: evaluated total missing from the overview');
  if (!ov.includes('id="ff-layout"') || !ov.includes('id="ff-ci"')) fail('architecture: fitness-function anchors missing from the overview');
  const age = (Date.now() - Date.parse(arch.generatedAt)) / 86400000;
  if (age > 8) console.warn(`warn: architecture.json is ${age.toFixed(0)} days old (\`make architecture\`)`);
}

// ---- executive briefings: every program page exists, deck quotes and counts agree ----
{
  const progs = Object.keys(brief.programs);
  if (briefPages.length !== 1 + progs.length) fail(`briefings: ${briefPages.length} pages, expected ${1 + progs.length} (hub + ${progs.length} programs)`);
  const allMembers = new Set(progs.flatMap((k) => brief.members[k]));
  for (const k of progs) {
    if (!exists(`briefings/${k}/index.html`)) fail(`briefings: page for ${k} missing`);
    const html = read(`briefings/${k}/index.html`);
    const members = brief.members[k];
    for (const id of members) {
      const deck = brief.decks[id];
      if (deck && !html.includes(`id="p-${id}"`)) fail(`briefings: ${k} page does not present the ${id} deck`);
    }
  }
  // every deck quoted on the pages belongs to a program or the platform strip
  for (const d of Object.values(brief.decks)) {
    if (!allMembers.has(d.repo) && !read('briefings/index.html').includes(d.repo)) fail(`briefings: deck ${d.repo} appears in neither a program nor the platform strip`);
  }
  if (brief.fleet.decks !== Object.keys(brief.decks).length) fail('briefings: fleet deck count disagrees with the deck list');
  const briefedInPrograms = progs.flatMap((k) => brief.members[k]).filter((id) => brief.decks[id]).length;
  const platformDecks = Object.keys(brief.decks).length - briefedInPrograms;
  if (!read('briefings/index.html').includes(new Intl.NumberFormat('en-US').format(brief.fleet.decks))) fail('briefings: deck total missing from the hub');
  if (platformDecks < 0) fail('briefings: more program decks than decks');
  // ecosystem decks: one per program that has one, hosted copy only (never a GitHub blob), linked from its program page and the hub
  const eco = brief.ecosystems || {};
  for (const k of ['wms-wes', 'retail', 'storefront']) {
    const e = eco[k];
    if (!e) { fail(`briefings: no ecosystem deck for ${k} (publish it on warehouse-docs, then \`make briefings\`)`); continue; }
    if (!e.bigIdea || e.takeaways.length !== 3 || !e.ask) fail(`briefings: ecosystem deck ${e.slug} is missing its big idea, three takeaways or ask`);
    const href = `/executive/${e.slug}/`;
    if (!read(`briefings/${k}/index.html`).includes(href)) fail(`briefings: ${k} page does not link its ecosystem deck`);
    if (!read('briefings/index.html').includes(href)) fail(`briefings: hub does not link the ${e.slug} ecosystem deck`);
  }
  for (const f of briefPages) if (read(f).includes('/blob/') ) fail(`briefings: ${f} links a GitHub blob page (renders source, unreadable): use the hosted deck URL`);
  const age = (Date.now() - Date.parse(brief.generatedAt)) / 86400000;
  if (age > 8) console.warn(`warn: briefings.json is ${age.toFixed(0)} days old (\`make briefings\`)`);
}


// ---- EventStorming: one board per context, every sticky provable, every count equal to the data ----
{
  const ids = facts.contexts.map((c) => c.id);
  if (esPages.length !== 1 + ids.length) fail(`eventstorming: ${esPages.length} pages, expected ${1 + ids.length} (hub + ${ids.length} boards)`);
  if (Object.keys(es.contexts).length !== ids.length) fail('eventstorming: data and facts disagree on the number of contexts');
  const hub = read('eventstorming/index.html');
  const fmt = (x) => new Intl.NumberFormat('en-US').format(x);
  // the hub: the nine sticky colours, the big picture, the index of every board
  for (const k of ['event', 'command', 'actor', 'agg', 'policy', 'read', 'system', 'hot', 'opp']) if (!hub.includes(`st st--${k}`)) fail(`eventstorming: the hub legend lacks the ${k} sticky`);
  const phases = es.ecosystem.phases;
  if ((hub.match(/<li class="bph"/g) || []).length !== phases.length) fail(`eventstorming: the big picture shows ${(hub.match(/<li class="bph"/g) || []).length} phases, data has ${phases.length}`);
  for (const ph of phases) {
    if (!hub.includes(`id="ph-${ph.id}"`)) fail(`eventstorming: phase ${ph.id} missing from the big picture`);
    if (!hub.includes('st--pivot')) fail('eventstorming: no pivotal event drawn');
  }
  for (const id of ids) if (!hub.includes(`href="/eventstorming/contexts/${id}/"`)) fail(`eventstorming: the hub index lacks ${id}`);
  if (!hub.includes(fmt(es.counts.events))) fail('eventstorming: event total missing from the hub');
  // the landing section prints the same counts as the data
  const home = read('index.html');
  for (const [k, v] of [['context boards', es.counts.contexts], ['domain events placed', es.counts.events], ['commands', es.counts.commands], ['policies', es.counts.policies], ['hot spots', es.counts.hotspots]]) {
    if (!home.includes(`<dt>${k}</dt><dd class="es-n">${fmt(v)}</dd>`)) fail(`eventstorming: landing section shows the wrong "${k}" (data says ${fmt(v)})`);
  }
  // counts add up across boards
  const sumK = (k) => Object.values(es.contexts).reduce((s, c) => s + c.counts[k], 0);
  for (const k of ['rows', 'events', 'commands', 'policies', 'reads', 'hotspots']) if (sumK(k) !== es.counts[k]) fail(`eventstorming: per-board ${k} do not sum to the total ${es.counts[k]}`);
  // every board: right h1, every published event drawn, every hot spot and row present, no placeholder
  for (const id of ids) {
    const f = `eventstorming/contexts/${id}/index.html`;
    if (!exists(f)) { fail(`eventstorming: board for ${id} missing`); continue; }
    const html = read(f).replace(/<wbr>/g, ''); const m = es.contexts[id];
    const h1 = html.match(/<h1>([^<]*)<\/h1>/);
    if (!h1 || h1[1] !== id) fail(`eventstorming: ${id} board has the wrong <h1>`);
    for (const ev of m.source.publishedEvents) if (!html.includes(`>${ev}</span>`)) fail(`eventstorming: ${id} board does not draw its published event ${ev}`);
    for (let i = 1; i <= m.rows.length; i++) if (!html.includes(`id="row-${i}"`)) fail(`eventstorming: ${id} board lacks row ${i}`);
    if ((html.match(/<li class="brow"/g) || []).length !== m.rows.length) fail(`eventstorming: ${id} board draws the wrong number of rows`);
    for (const h of m.hotspots || []) if (!html.includes(esc(h.text))) fail(`eventstorming: ${id} board lacks a hot spot`);
    if (!html.includes('st st--agg') && m.rows.some((r) => r.aggregate)) fail(`eventstorming: ${id} board draws no aggregate`);
    for (const r of m.rows) if (!r.evidence?.length) fail(`eventstorming: ${id} has a row without evidence`);
  }
  const age = (Date.now() - Date.parse(es.generatedAt)) / 86400000;
  if (age > 45) console.warn(`warn: eventstorming.json is ${age.toFixed(0)} days old (\`make eventstorming\`)`);
}

// ---- size budget (bytes, uncompressed) ----
// The landing page keeps its own budget; the generated engineering study under /engineering/ has a separate one.
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(DIST);
const engDir = path.join(DIST, 'engineering') + path.sep;
const archDir = path.join(DIST, 'architecture') + path.sep;
const briefDir = path.join(DIST, 'briefings') + path.sep;
const esDir = path.join(DIST, 'eventstorming') + path.sep;
const sum = (re, pick = (f) => !f.startsWith(engDir) && !f.startsWith(archDir) && !f.startsWith(briefDir) && !f.startsWith(esDir)) => files.filter((f) => pick(f) && re.test(f)).reduce((s, f) => s + fs.statSync(f).size, 0);
const budget = [['html', /\.html$/, 90e3], ['css', /\.css$/, 90e3], ['js', /\.js$/, 50e3], ['fonts', /\.woff2$/, 200e3], ['total', /./, 700e3]];
for (const [name, re, max] of budget) {
  const n = sum(re);
  if (n > max) fail(`budget: ${name} is ${(n / 1024).toFixed(0)} KiB, max ${(max / 1024).toFixed(0)} KiB`);
}
const engHtml = sum(/\.html$/, (f) => f.startsWith(engDir));
const engLargest = Math.max(...files.filter((f) => f.startsWith(engDir)).map((f) => fs.statSync(f).size));
if (engHtml > 4e6) fail(`budget: engineering html is ${(engHtml / 1024).toFixed(0)} KiB, max 3906 KiB`);
if (engLargest > 250e3) fail(`budget: largest engineering page is ${(engLargest / 1024).toFixed(0)} KiB, max 244 KiB`);
const archHtml = sum(/\.html$/, (f) => f.startsWith(archDir));
const archLargest = Math.max(...files.filter((f) => f.startsWith(archDir)).map((f) => fs.statSync(f).size));
if (archHtml > 2e6) fail(`budget: architecture html is ${(archHtml / 1024).toFixed(0)} KiB, max 1953 KiB`);
if (archLargest > 120e3) fail(`budget: largest architecture page is ${(archLargest / 1024).toFixed(0)} KiB, max 117 KiB`);
const briefHtml = sum(/\.html$/, (f) => f.startsWith(briefDir));
const briefLargest = Math.max(...files.filter((f) => f.startsWith(briefDir)).map((f) => fs.statSync(f).size));
if (briefHtml > 1.5e6) fail(`budget: briefings html is ${(briefHtml / 1024).toFixed(0)} KiB, max 1464 KiB`);
const esHtml = sum(/\.html$/, (f) => f.startsWith(esDir));
const esLargest = Math.max(...files.filter((f) => f.startsWith(esDir)).map((f) => fs.statSync(f).size));
if (esHtml > 2.5e6) fail(`budget: eventstorming html is ${(esHtml / 1024).toFixed(0)} KiB, max 2441 KiB`);
if (esLargest > 180e3) fail(`budget: largest eventstorming page is ${(esLargest / 1024).toFixed(0)} KiB, max 176 KiB`);
if (briefLargest > 220e3) fail(`budget: largest briefings page is ${(briefLargest / 1024).toFixed(0)} KiB, max 214 KiB`);
// hashed asset referenced by the page must exist (catches a stale dist)
for (const m of read('index.html').matchAll(/(?:href|src)="(\/assets\/(?:css|js)\/[^"]+)"/g)) if (!exists(m[1].slice(1))) fail(`missing hashed asset ${m[1]}`);

if (errors.length) {
  console.error(`check failed (${errors.length}):\n - ${errors.join('\n - ')}`);
  process.exit(1);
}
console.log(`check ok: ${files.length} files (${engPages.length} engineering, ${archPages.length} architecture, ${briefPages.length} briefing pages, ${esPages.length} eventstorming pages), html ${(sum(/\.html$/) / 1024).toFixed(0)} KiB, css ${(sum(/\.css$/) / 1024).toFixed(0)} KiB, js ${(sum(/\.js$/) / 1024).toFixed(0)} KiB, fonts ${(sum(/\.woff2$/) / 1024).toFixed(0)} KiB`);

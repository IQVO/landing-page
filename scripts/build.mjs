#!/usr/bin/env node
// Zero-dependency static build: src/ -> dist/.
//   * renders {{placeholders}} in src/index.html from data/facts.json + site.config.json
//   * embeds the map data as inline JSON (no extra request)
//   * content-hashes css/js so nginx can serve them `immutable`
// Usage: node scripts/build.mjs   (SITE_URL=https://example.com for absolute OG/canonical URLs)

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
if (process.env.SITE_URL) cfg.siteUrl = process.env.SITE_URL;
if (process.env.DOCS_URL) cfg.docsUrl = process.env.DOCS_URL;
cfg.siteUrl = (cfg.siteUrl || '').replace(/\/+$/, '');
cfg.docsUrl = cfg.docsUrl.replace(/\/+$/, '');
const facts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'facts.json'), 'utf8'));

// ---------- view model: friendly keys over facts.json ----------
const fmt = (n) => new Intl.NumberFormat('en-US').format(n);
const dt = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const t = facts.ai.coAuthorTrailers;
const days = Math.round((Date.parse(facts.counts.lastCommit) - Date.parse(facts.counts.firstCommit)) / 86400000);
const trailerTotal = facts.ai.coAuthorTrailerTotal;
const view = {
  docs: cfg.docsUrl,
  github: cfg.githubUrl,
  contexts: facts.counts.contexts,
  wms: facts.counts.byDomain.wms,
  wes: facts.counts.byDomain.wes,
  retail: facts.counts.byDomain['retail-network'],
  storefront: facts.counts.byDomain.storefront,
  core: facts.counts.byClassification.Core,
  edges: facts.counts.eventEdges,
  mcp: facts.counts.mcpServers,
  a2a: facts.counts.a2aAgents,
  adrs: fmt(facts.counts.adrs),
  commits: fmt(facts.counts.commits),
  repos: facts.counts.publicRepos,
  days,
  first: dt(facts.counts.firstCommit),
  updated: dt(facts.generatedAt),
  incidents: facts.harness.incidents,
  guarded: facts.harness.incidentsGuarded,
  fitness: facts.harness.fitnessTests,
  tr: {
    total: fmt(trailerTotal),
    sonnet55: t['Claude Sonnet 5.5'] || 0,
    opus55: t['Claude Opus 5.5'] || 0,
    sonnet5: t['Claude Sonnet 5'] || 0,
    opus5: t['Claude Opus 5 (1M context)'] || 0,
    other: t['Claude'] || 0,
  },
  trRaw: trailerTotal,
};

// map payload: only what the browser needs
const ids = facts.contexts.map((c) => c.id);
const deg = { in: {}, out: {} };
for (const e of facts.edges) { deg.out[e.from] = (deg.out[e.from] || 0) + 1; deg.in[e.to] = (deg.in[e.to] || 0) + 1; }
const mapData = {
  docs: cfg.docsUrl,
  github: cfg.githubUrl,
  nodes: facts.contexts.map((c) => ({
    id: c.id, d: c.domain, k: c.classification, p: c.purpose, x: c.x, y: c.y,
    m: c.mcp ? 1 : 0, a: c.a2a ? 1 : 0, r: c.adrs, o: deg.out[c.id] || 0, i: deg.in[c.id] || 0,
  })),
  edges: facts.edges.map((e) => [ids.indexOf(e.from), ids.indexOf(e.to)]),
};

const lookup = (obj, p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

function render(html) {
  // conditionals: {{#key}}...{{/key}} kept only when cfg[key] is non-empty
  html = html.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, k, body) => (cfg[k] ? body : ''));
  html = html.replace(/\{\{json:map\}\}/g, () => JSON.stringify(mapData).replace(/</g, '\\u003c'));
  html = html.replace(/\{\{siteUrl\}\}/g, cfg.siteUrl);
  return html.replace(/\{\{([\w.]+)\}\}/g, (m, p) => {
    const v = lookup(view, p);
    if (v === undefined) throw new Error(`unresolved placeholder ${m}`);
    return String(v);
  });
}

// ---------- copy + hash assets ----------
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const hashed = new Map(); // "/assets/css/main.css" -> "/assets/css/main.<h>.css"
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, ent.name), d = path.join(to, ent.name);
    if (ent.isDirectory()) { copyTree(s, d); continue; }
    if (/\.(css|js)$/.test(ent.name)) {
      const buf = fs.readFileSync(s);
      const h = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
      const out = ent.name.replace(/\.(css|js)$/, `.${h}.$1`);
      fs.writeFileSync(path.join(to, out), buf);
      hashed.set('/' + path.relative(SRC, s).split(path.sep).join('/'), '/' + path.relative(DIST, path.join(to, out)).split(path.sep).join('/'));
    } else fs.copyFileSync(s, d);
  }
}
copyTree(path.join(SRC, 'assets'), path.join(DIST, 'assets'));

// root-level static files (favicons, robots, 404, og image ...)
for (const ent of fs.readdirSync(SRC, { withFileTypes: true })) {
  if (ent.isDirectory() || ent.name === 'index.html' || ent.name === '404.html') continue;
  fs.copyFileSync(path.join(SRC, ent.name), path.join(DIST, ent.name));
}

for (const page of ['index.html', '404.html']) {
  const f = path.join(SRC, page);
  if (!fs.existsSync(f)) continue;
  let html = render(fs.readFileSync(f, 'utf8'));
  for (const [from, to] of hashed) html = html.split(`"${from}"`).join(`"${to}"`);
  fs.writeFileSync(path.join(DIST, page), html);
}
fs.writeFileSync(path.join(DIST, 'healthz'), 'ok');

const size = (p) => fs.statSync(p).size;
const total = (function walk(d) { return fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? walk(path.join(d, e.name)) : size(path.join(d, e.name))), 0); })(DIST);
console.log(`built dist/ (${(total / 1024).toFixed(0)} KiB, ${hashed.size} hashed assets) site=${cfg.siteUrl || '(relative)'} docs=${cfg.docsUrl}`);

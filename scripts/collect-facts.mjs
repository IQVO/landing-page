#!/usr/bin/env node
// Collects every number and map datum the landing page shows, from the real
// repositories. Nothing on the page is typed by hand if a repo can answer it.
//
//   node scripts/collect-facts.mjs            # needs the sibling checkouts
//   WS_ROOT=/path/to/warehouse-systems node scripts/collect-facts.mjs
//
// Reads `origin/develop` (else `origin/main`) of each context repo through
// `git show`, never the working tree, because local trees are often stale.
// Writes data/facts.json (committed) so `make build` works anywhere.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = process.env.WS_ROOT || path.resolve(HERE, '..', '..');
const OUT = path.resolve(HERE, '..', 'data', 'facts.json');

const git = (repo, ...args) => {
  try {
    return execFileSync('git', ['-C', path.join(ROOT, repo), ...args], {
      encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch { return null; }
};
const refOf = (repo) => ['origin/develop', 'origin/main'].find((r) => git(repo, 'rev-parse', '--verify', '-q', r) !== null);
const show = (repo, ref, p) => git(repo, 'show', `${ref}:${p}`);
const lsTree = (repo, ref, p) => (git(repo, 'ls-tree', '--name-only', `${ref}:${p}`) || '').split('\n').filter(Boolean);

// ---- 1. the contexts (single source of truth: the EventCatalog registry) ----
const catalog = await import(url.pathToFileURL(path.join(ROOT, 'ecosystem', 'catalog.contexts.mjs')).href);
const CONTEXTS = catalog.CONTEXTS;
const firstSentence = (s) => s.split(/(?<=\.)\s/)[0];

const contexts = [];
for (const [id, c] of Object.entries(CONTEXTS)) {
  const ref = refOf(id);
  const cmd = ref ? lsTree(id, ref, 'cmd') : [];
  let adrs = 0;
  for (const dir of ['docs/adr', 'docs/docs/adr', 'adr']) {
    const n = ref ? lsTree(id, ref, dir).filter((f) => /^\d{3,4}-.*\.md$/.test(f)).length : 0;
    if (n) { adrs = n; break; }
  }
  const asyncapi = ref ? show(id, ref, 'apis/asyncapi.yaml') : null;
  const channels = [];
  if (asyncapi) {
    let inChannels = false;
    for (const line of asyncapi.split('\n')) {
      if (/^channels:\s*$/.test(line)) { inChannels = true; continue; }
      if (inChannels && /^\S/.test(line)) break;
      const m = inChannels && line.match(/^ {2}([A-Za-z0-9._-]+):\s*$/);
      if (m) channels.push(m[1]);
      // AsyncAPI 3 keeps the topic in `address:` and a camelCase key in the map.
      const a = inChannels && line.match(/^ {4}address:\s*['"]?([A-Za-z0-9._-]+)['"]?\s*$/);
      if (a) channels.push(a[1]);
    }
  }
  contexts.push({
    id,
    domain: c.subdomain,
    classification: c.classification,
    purpose: firstSentence(c.purpose),
    publishes: c.topics || [],
    channels,
    mcp: cmd.includes('mcp'),
    a2a: cmd.includes('a2a'),
    adrs,
    ref: ref || null,
  });
}

// ---- 2. event edges: publisher -> every context that lists its topic ----
const edges = [];
const seen = new Set();
for (const p of contexts) {
  for (const topic of p.publishes) {
    for (const c of contexts) {
      if (c.id === p.id || !c.channels.includes(topic)) continue;
      const key = `${p.id}>${c.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: p.id, to: c.id });
    }
  }
}

// ---- 3. deterministic layout (seeded force simulation, frozen) ----
const W = 1000, H = 760;
const anchors = { wms: [215, 215], wes: [430, 470], 'retail-network': [790, 215], storefront: [790, 590] };
let seed = 20261003;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const idx = new Map(contexts.map((c, i) => [c.id, i]));
const pos = contexts.map((c) => {
  const [ax, ay] = anchors[c.domain];
  return { x: ax + (rnd() - 0.5) * 160, y: ay + (rnd() - 0.5) * 160, vx: 0, vy: 0 };
});
const radius = (c) => (c.classification === 'Core' ? 17 : c.classification === 'Generic' ? 10 : 12.5);
for (let it = 0; it < 900; it++) {
  const k = 1 - it / 900;
  for (let i = 0; i < pos.length; i++) {
    for (let j = i + 1; j < pos.length; j++) {
      let dx = pos[j].x - pos[i].x, dy = pos[j].y - pos[i].y;
      let d2 = dx * dx + dy * dy || 0.01; const d = Math.sqrt(d2);
      const min = radius(contexts[i]) + radius(contexts[j]) + 78;
      const f = (d < min ? 5200 : 2400) / d2;
      dx /= d; dy /= d;
      pos[i].vx -= dx * f; pos[i].vy -= dy * f; pos[j].vx += dx * f; pos[j].vy += dy * f;
    }
  }
  for (const e of edges) {
    const a = pos[idx.get(e.from)], b = pos[idx.get(e.to)];
    const same = contexts[idx.get(e.from)].domain === contexts[idx.get(e.to)].domain;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
    const f = (d - (same ? 170 : 300)) * 0.0035;
    a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
  }
  contexts.forEach((c, i) => {
    const [ax, ay] = anchors[c.domain];
    pos[i].vx += (ax - pos[i].x) * 0.006; pos[i].vy += (ay - pos[i].y) * 0.006;
    pos[i].x += Math.max(-9, Math.min(9, pos[i].vx * 0.5 * k + pos[i].vx * 0.1)); pos[i].y += Math.max(-9, Math.min(9, pos[i].vy * 0.5 * k + pos[i].vy * 0.1));
    pos[i].vx *= 0.55; pos[i].vy *= 0.55;
    pos[i].x = Math.max(46, Math.min(W - 46, pos[i].x)); pos[i].y = Math.max(46, Math.min(H - 46, pos[i].y));
  });
}
contexts.forEach((c, i) => { c.x = Math.round(pos[i].x); c.y = Math.round(pos[i].y); });

// ---- 4. the git record across every checked-out repository ----
const repos = fs.readdirSync(ROOT).filter((d) => fs.existsSync(path.join(ROOT, d, '.git'))
  && !/^(wt-|bm-|not_working)/.test(d) && d !== '.worktrees');
const hashes = new Set();
const trailers = {};
let first = null, last = null;
for (const r of repos) {
  const out = git(r, 'log', '--all', '--format=%H%x1f%aI%x1f%B%x1e');
  if (!out) continue;
  for (const rec of out.split('\x1e')) {
    const [h, iso, body = ''] = rec.replace(/^\n/, '').split('\x1f');
    if (!h || hashes.has(h)) continue;
    hashes.add(h);
    if (!first || iso < first) first = iso;
    if (!last || iso > last) last = iso;
    for (const m of body.matchAll(/^co-authored-by:\s*(.+?)\s*<[^>]*>/gim)) {
      const who = m[1].trim();
      if (/^claude/i.test(who)) trailers[who] = (trailers[who] || 0) + 1;
    }
  }
}
const aiTrailerTotal = Object.values(trailers).reduce((a, b) => a + b, 0);

// ---- 5. the harness: incidents, fitness tests ----
const T = 'warehouse-harness-template';
const tref = refOf(T);
const incidents = (show(T, tref, 'INCIDENTS.md') || '').split('\n').filter((l) => /^\| 20\d\d-/.test(l));
const guarded = incidents.filter((l) => /\bguarded\b/i.test(l.split('|').slice(-2)[0] || '')).length;
let fitnessTests = 0;
for (const f of lsTree(T, tref, 'internal/architecture').filter((f) => f.endsWith('_test.go'))) {
  fitnessTests += ((show(T, tref, `internal/architecture/${f}`) || '').match(/^func Test\w+\(/gm) || []).length;
}
const ghRepos = (() => {
  try {
    const out = execFileSync('gh', ['api', 'orgs/IQVO', '--jq', '.public_repos'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return Number(out.trim()) || null;
  } catch { return null; }
})();

// ---- 6. assemble ----
const by = (key) => contexts.reduce((m, c) => ((m[c[key]] = (m[c[key]] || 0) + 1), m), {});
const facts = {
  generatedAt: new Date().toISOString(),
  note: 'Generated by scripts/collect-facts.mjs from the repositories. Do not hand-edit.',
  counts: {
    contexts: contexts.length,
    byDomain: by('domain'),
    byClassification: Object.fromEntries(Object.entries(by('classification'))),
    eventEdges: edges.length,
    mcpServers: contexts.filter((c) => c.mcp).length,
    a2aAgents: contexts.filter((c) => c.a2a).length,
    adrs: contexts.reduce((s, c) => s + c.adrs, 0),
    publicRepos: ghRepos,
    commits: hashes.size,
    firstCommit: first,
    lastCommit: last,
    reposScanned: repos.length,
  },
  ai: { coAuthorTrailers: trailers, coAuthorTrailerTotal: aiTrailerTotal },
  harness: { incidents: incidents.length, incidentsGuarded: guarded, fitnessTests },
  contexts,
  edges,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(facts, null, 1) + '\n');
console.log(JSON.stringify({ ...facts.counts, ai: facts.ai, harness: facts.harness }, null, 1));

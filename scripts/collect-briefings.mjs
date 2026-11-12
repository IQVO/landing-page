#!/usr/bin/env node
// Collects the executive briefings: parses each repository's committed reveal.js deck
// (executive/index.html at origin/<default>) — the speaker notes carry the full, un-clamped
// research text — and joins it with the day's engineering/architecture counts.
// Writes data/briefings.json. Nothing is typed by hand (ADR 0002, ADR 0005).
//
//   node scripts/collect-briefings.mjs          # needs fetched sibling clones + the day's
//                                               # data/engineering.json + data/architecture.json

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = process.env.WS_ROOT || path.resolve(HERE, '..', '..');
const OUT = path.resolve(HERE, '..', 'data', 'briefings.json');
const ENG = path.resolve(HERE, '..', 'data', 'engineering.json');
const ARCH = path.resolve(HERE, '..', 'data', 'architecture.json');
const FACTS = path.resolve(HERE, '..', 'data', 'facts.json');

const gitOk = (repo, ...args) => { try { return execFileSync('git', ['-C', path.join(ROOT, repo), ...args], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
const stripTags = (s) => s
  .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&rsquo;/g, '\u2019').replace(/&middot;/g, '·').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–');

const eng = JSON.parse(fs.readFileSync(ENG, 'utf8'));
const arch = JSON.parse(fs.readFileSync(ARCH, 'utf8'));
const facts = JSON.parse(fs.readFileSync(FACTS, 'utf8'));
const CTX = new Map(facts.contexts.map((c) => [c.id, c]));

// how a repository's briefing is presented: the four programs + the platform strip on the hub
const PROGRAMS = {
  'wms-wes': { label: 'WMS and WES', domains: ['wms', 'wes'] },
  yms: { label: 'Yard management', domains: [], members: ['yard-management', 'linehaul-transportation', 'exception-management', 'dock-scheduling'] },
  retail: { label: 'Retail network', domains: ['retail-network'] },
  storefront: { label: 'Storefront', domains: ['storefront'] },
};
const PLATFORM = new Set(['warehouse-console', 'warehouse-ui-kit', 'warehouse-floor-client', 'warehouse-infra',
  'warehouse-harness-template', 'warehouse-docs', 'warehouse-ops-agent', 'e2e-tests', 'e2s-tests', 'landing-page', 'ecosystem', 'provisioning', 'checkout']);

function parseDeck(html, name) {
  const secs = [...html.matchAll(/<section[^>]*>([\s\S]*?)<\/section>/g)].map((m) => m[1]);
  const notes = (sec) => { const m = sec.match(/<aside class="notes">([\s\S]*?)<\/aside>/); return m ? stripTags(m[1]).trim() : ''; };
  const title = (sec) => { const m = sec.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/); return m ? stripTags(m[1]).trim() : ''; };
  const lis = (sec) => [...sec.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => stripTags(m[1]).trim());
  const tds = (sec) => Object.fromEntries([...sec.matchAll(/<tr><td[^>]*>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><\/tr>/g)].map((m) => [stripTags(m[1]).trim(), stripTags(m[2]).trim()]));
  const out = { capabilities: [], domainModel: [], eventsProduced: [], eventsConsumed: [], observability: {}, metrics: {}, nextSteps: [], risks: [] };
  for (const sec of secs) {
    const t = title(sec); const n = notes(sec); const plain = stripTags(sec).slice(0, 400);
    if (t.startsWith('Mission')) out.mission = n;
    else if (t.startsWith('What This Delivers')) out.capabilities = n.split('\n').filter(Boolean).slice(0, 6);
    else if (t.startsWith('Ubiquitous')) { out.domainModel = lis(sec).slice(0, 8); }
    else if (t.startsWith('Hexagonal') || t.startsWith('Platform Architecture')) {
      out.style = (n.match(/^STYLE: (.+)$/m) || [])[1] || null;
      out.stack = ((n.match(/^STACK: (.+)$/m) || [])[1] || '').split(', ').filter(Boolean).slice(0, 8);
      const td = tds(sec);
      if (td.Storage) out.storage = td.Storage;
    } else if (t === 'CloudEvents on Kafka') {
      let cur = null;
      for (const line of n.split('\n')) {
        if (line.startsWith('PRODUCED:')) cur = out.eventsProduced;
        else if (line.startsWith('CONSUMED:')) cur = out.eventsConsumed;
        else if (line && cur) cur.push(line.trim());
      }
    } else if (t === 'Production-Grade Discipline' || t === 'Correlation & Discipline' || t === 'One Pipeline: Traces, Metrics, Logs') {
      out.observability.stack = (n.match(/^STACK: (.+)$/m) || [])[1] || null;
      out.observability.practices = ((n.match(/^PRACTICES: (.+)$/m) || [])[1] || '').split(' | ').filter(Boolean).slice(0, 5);
    } else if (t === 'Engineering Footprint') {
      const tiles = [...sec.matchAll(/<div class="n">([^<]*)<\/div><div class="l">([^<]*)<\/div>/g)];
      for (const [v, l] of tiles.map((m) => [m[1], m[2]])) {
        if (l === 'DB migrations') out.metrics.migrations = Number(v) || 0;
        else if (l === 'BDD feature files') out.metrics.features = Number(v) || 0;
        else if (l === 'Architecture decisions') out.metrics.adrs = Number(v) || 0;
      }
    } else if (t === 'Next Steps') out.nextSteps = n.split('\n').filter(Boolean).slice(0, 3);
    else if (t.startsWith('Risks')) out.risks = n.split('\n').filter(Boolean).slice(0, 3);
    else if (!t && n && plain.includes('executive briefing')) out.tagline = n.split('\n')[0];
  }
  if (!out.tagline) out.tagline = eng.repos[name]?.description || null;
  return out;
}

const deckRepos = [];
for (const [name, e] of Object.entries(eng.repos)) {
  const ref = `origin/${e.defaultBranch}`;
  const has = (gitOk(name, 'ls-tree', '-r', '--name-only', ref) || '').split('\n').includes('executive/index.html');
  if (has) deckRepos.push({ name, ref });
}

const decks = {};
for (const { name, ref } of deckRepos) {
  const html = gitOk(name, 'show', `${ref}:executive/index.html`) || '';
  const d = parseDeck(html, name);
  d.repo = name; d.defaultBranch = eng.repos[name].defaultBranch;
  decks[name] = d;
  process.stdout.write(`  ${name}: mission ${d.mission ? 'y' : 'n'}, ${d.capabilities.length} caps, ${d.eventsProduced.length}/${d.eventsConsumed.length} events\n`);
}

// program membership for every domain context (deck or not); explicit members win over registry domains
const members = Object.fromEntries(Object.keys(PROGRAMS).map((k) => [k, []]));
for (const c of facts.contexts) {
  let prog = Object.entries(PROGRAMS).find(([, p]) => p.members?.includes(c.id))?.[0];
  if (!prog) prog = Object.entries(PROGRAMS).find(([, p]) => p.domains.includes(c.domain))?.[0];
  if (!prog) prog = 'wms-wes'; // contexts newer than the registry domains land with the warehouse core
  members[prog].push(c.id);
}

// event edges between contexts, once per direction (facts edges are routes on the map)
const edges = facts.edges.map((e) => ({ from: e.from, to: e.to }));

const fleet = {
  decks: deckRepos.length,
  contexts: facts.counts.contexts,
  programs: Object.keys(PROGRAMS).length,
  events: facts.counts.eventEdges,
};
const out = {
  generatedAt: new Date().toISOString(),
  note: 'Generated by scripts/collect-briefings.mjs from the committed executive decks + the day\'s counts. Do not hand-edit.',
  engGeneratedAt: eng.generatedAt,
  programs: PROGRAMS, members, edges, fleet, decks,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${fleet.decks} decks, ${fleet.contexts} contexts, ${members['wms-wes'].length} wms/wes + ${members.retail.length} retail + ${members.yms.length} yms + ${members.storefront.length} storefront`);

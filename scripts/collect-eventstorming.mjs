#!/usr/bin/env node
// EventStorming boards: reads each hand-authored board model (model/eventstorming/<context>.json) and the
// big-picture model (model/eventstorming/ecosystem.json), proves every sticky against the REAL sources of the
// sibling repositories (origin/develop via `git show`, never the working tree) and writes data/eventstorming.json.
//
//   node scripts/collect-eventstorming.mjs                    # validate every model, write data/eventstorming.json
//   node scripts/collect-eventstorming.mjs --digest <ctx>     # print what the sources say about one context
//   node scripts/collect-eventstorming.mjs --check <file>     # validate ONE model file (exit 1 on error), writes nothing
//   WS_ROOT=/path/to/warehouse-systems node scripts/collect-eventstorming.mjs
//
// A model is a reconstruction from code and docs, never a workshop output. What a model may NOT do:
//   * name an event the context does not declare in apis/asyncapi.yaml (own topics),
//   * react to an event the producer does not declare,
//   * name an operationId the context's apis/openapi.yaml does not have,
//   * name an aggregate that is not a type under internal/domain,
//   * point at an evidence file that does not exist at origin/develop,
//   * leave out an event the context publishes (full coverage is the rule).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const ROOT = process.env.WS_ROOT || path.resolve(REPO, '..');
const MODELS = path.join(REPO, 'model', 'eventstorming');
const OUT = path.join(REPO, 'data', 'eventstorming.json');
const FACTS = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'facts.json'), 'utf8'));

const git = (repo, ...args) => {
  try {
    return execFileSync('git', ['-C', path.join(ROOT, repo), ...args], {
      encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch { return null; }
};
const refOf = (repo) => ['origin/develop', 'origin/main'].find((r) => git(repo, 'rev-parse', '--verify', '-q', r) !== null);
const show = (repo, ref, p) => git(repo, 'show', `${ref}:${p}`);
// results that only depend on a commit are cached under the OS temp dir, keyed by repo, commit and CACHE_VERSION
const CACHE_VERSION = 4;
const CACHE_DIR = path.join(os.tmpdir(), 'iqvo-es-cache');
function cached(repo, ref, kind, fn) {
  const sha = (git(repo, 'rev-parse', ref) || '').trim();
  const file = path.join(CACHE_DIR, `${repo}-${kind}-v${CACHE_VERSION}-${sha}.json`);
  if (sha && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const v = fn();
  if (sha) { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(file, JSON.stringify(v)); }
  return v;
}
const treeCache = new Map();
const exists = (repo, ref, p) => {
  if (!treeCache.has(repo)) treeCache.set(repo, new Set(cached(repo, ref, 'tree', () => (git(repo, 'ls-tree', '-r', '--name-only', ref) || '').split('\n').filter(Boolean))));
  return treeCache.get(repo).has(p);
};
const lsTree = (repo, ref, p) => (git(repo, 'ls-tree', '--name-only', `${ref}:${p}`) || '').split('\n').filter(Boolean);

const CTX = new Map(FACTS.contexts.map((c) => [c.id, c]));
const EDGE = new Set(FACTS.edges.map((e) => `${e.from}>${e.to}`));

// ---------------------------------------------------------------- source digest
const TYPE_RE = /com\.[a-z0-9]+\.[a-z0-9.\-]+\.[A-Z][A-Za-z0-9]+/;

function parseAsyncapi(text, ownTopics) {
  const lines = text.split('\n');
  const messages = {}; // key -> { name, type }
  const channels = []; // { topic, keys }
  let sec = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l)) sec = l.replace(/:.*$/, '');
    if (sec === 'components' && /^ {2}messages:\s*$/.test(l)) {
      let key = null, block = [];
      const flush = () => {
        if (!key) return;
        const joined = block.join('\n');
        const nm = joined.match(/^ {6}name:\s*['"]?([^'"\n]+?)['"]?\s*$/m);
        const ex = joined.match(/^\s+type:\s*['"]?(com\.[^'"\s]+)/m) || joined.match(TYPE_RE);
        const type = ex ? (ex[1] || ex[0]) : null;
        messages[key] = { name: nm ? nm[1] : key, type };
      };
      for (let j = i + 1; j < lines.length; j++) {
        const m = lines[j];
        if (/^ {0,2}\S/.test(m)) { i = j - 1; break; }
        const k = m.match(/^ {4}([A-Za-z0-9_.\-]+):\s*$/);
        if (k) { flush(); key = k[1]; block = []; } else block.push(m);
        if (j === lines.length - 1) i = j;
      }
      flush();
    }
    if (sec === 'channels') {
      const c = l.match(/^ {2}([A-Za-z0-9._\-{}]+):\s*$/);
      if (c) channels.push({ key: c[1], topic: c[1], keys: [], lines: [] });
      else if (channels.length) {
        const ch = channels[channels.length - 1];
        const a = l.match(/^ {4}address:\s*['"]?([A-Za-z0-9._\-]+)['"]?\s*$/);
        if (a) ch.topic = a[1];
        const r = l.match(/\$ref:\s*['"]?#\/components\/messages\/([A-Za-z0-9_.\-]+)/);
        if (r && !ch.keys.includes(r[1])) ch.keys.push(r[1]);
      }
    }
  }
  const out = { published: [], consumed: [] };
  for (const ch of channels) {
    const own = ownTopics.includes(ch.topic);
    for (const k of ch.keys) {
      const m = messages[k] || { name: k, type: null };
      const analytics = /\.(analytics|wes\.analytics)$/.test(ch.topic) || /analytics/i.test(ch.key) || /analytics/i.test(ch.topic);
      // the message's own `name:` is the event name; an analytics-stream copy may be suffixed "Analytics"
      const evName = analytics ? m.name.replace(/^Analytics(?=[A-Z])/, '').replace(/Analytics$/, '') : m.name;
      const row = { name: evName, topic: ch.topic, type: m.type, typeName: m.type ? m.type.split('.').pop() : null };
      if (own) out.published.push({ ...row, analytics });
      else {
        const seg = m.type ? m.type.split('.') : [];
        const from = [...CTX.keys()].find((id) => seg.includes(id)) || null;
        out.consumed.push({ ...row, from });
      }
    }
  }
  return out;
}

function parseOpenapi(text) {
  const ops = [];
  let inPaths = false, p = null, method = null, cur = null;
  for (const l of text.split('\n')) {
    if (/^paths:\s*$/.test(l)) { inPaths = true; continue; }
    if (inPaths && /^\S/.test(l)) break;
    if (!inPaths) continue;
    const pm = l.match(/^ {2}['"]?(\/[^'":]*)['"]?:\s*$/);
    if (pm) { p = pm[1]; method = null; continue; }
    const mm = l.match(/^ {4}(get|post|put|patch|delete):\s*$/);
    if (mm) { method = mm[1]; cur = { method, path: p, operationId: null, summary: '' }; ops.push(cur); continue; }
    if (cur && method) {
      const o = l.match(/^ {6}operationId:\s*['"]?([^'"\s]+)/); if (o) cur.operationId = o[1];
      const s = l.match(/^ {6}summary:\s*['"]?(.+?)['"]?\s*$/); if (s && !cur.summary) cur.summary = s[1];
    }
  }
  return ops.filter((o) => o.operationId);
}

const digestCache = new Map();
export function digest(id) {
  if (digestCache.has(id)) return digestCache.get(id);
  const ref = refOf(id);
  const d = ref ? cached(id, ref, 'digest', () => buildDigest(id, ref)) : buildDigest(id, ref);
  digestCache.set(id, d);
  return d;
}
function buildDigest(id, ref) {
  const c = CTX.get(id);
  const d = { id, ref, publishes: [], consumes: [], operations: [], domainTypes: [], usecases: [], adrs: [], kafkaInbound: [] };
  if (!c || !ref) return d;
  const ay = show(id, ref, 'apis/asyncapi.yaml');
  if (ay) { const a = parseAsyncapi(ay, c.publishes); d.publishes = a.published; d.consumes = a.consumed; }
  const oa = show(id, ref, 'apis/openapi.yaml');
  if (oa) d.operations = parseOpenapi(oa);
  const g = git(id, 'grep', '-n', '-E', '^type [A-Z][A-Za-z0-9_]* ', ref, '--', 'internal/domain') || '';
  for (const line of g.split('\n')) {
    const m = line.match(/^[^:]+:(internal\/domain\/[^:]+):\d+:type ([A-Z][A-Za-z0-9_]*) (\w+)/);
    if (m && !/_test\.go$/.test(m[1])) d.domainTypes.push({ name: m[2], kind: m[3], file: m[1] });
  }
  const u = git(id, 'grep', '-n', '-E', '^type [A-Z][A-Za-z0-9_]* struct', ref, '--', 'internal/application/usecases') || '';
  for (const line of u.split('\n')) {
    const m = line.match(/^[^:]+:(internal\/application\/usecases\/[^:]+):\d+:type ([A-Z][A-Za-z0-9_]*) struct/);
    if (m && !/_test\.go$/.test(m[1])) d.usecases.push({ name: m[2], file: m[1] });
  }
  for (const dir of ['docs/adr', 'docs/docs/adr', 'adr']) {
    const f = lsTree(id, ref, dir).filter((x) => /^\d{3,4}-.*\.md$/.test(x));
    if (f.length) { d.adrs = f.map((x) => `${dir}/${x}`); break; }
  }
  d.kafkaInbound = lsTree(id, ref, 'internal/adapters/inbound/kafka').filter((f) => /\.go$/.test(f) && !/_test\.go$/.test(f));
  return d;
}

// ---------------------------------------------------------------- validation
const KINDS = new Set(['actor', 'external', 'timer', 'event']);
const MAXLEN = { oneLine: 170, title: 64, story: 260, name: 42, policy: 120, does: 120, text: 170, read: 56 };

export function validate(model, label = model.context) {
  const errs = [], warns = [];
  const E = (m) => errs.push(`${label}: ${m}`);
  const W = (m) => warns.push(`${label}: ${m}`);
  const id = model.context;
  const c = CTX.get(id);
  if (!c) { E(`context "${id}" is not in data/facts.json`); return { errs, warns }; }
  const d = digest(id);
  const ref = d.ref;
  if (!ref) { E('no origin/develop or origin/main in the sibling checkout'); return { errs, warns }; }
  const len = (s, k, what) => { if (typeof s !== 'string' || !s.trim()) E(`${what} is empty`); else if (s.length > MAXLEN[k]) E(`${what} is ${s.length} chars (max ${MAXLEN[k]}): "${s.slice(0, 50)}…"`); };
  len(model.oneLine, 'oneLine', 'oneLine');
  const pub = new Map(d.publishes.map((p) => [p.name, p]));
  const opIds = new Set(d.operations.map((o) => o.operationId));
  const aggTypes = new Set(d.domainTypes.map((t) => t.name));
  const evidenceOk = (p, what) => {
    if (typeof p !== 'string' || !p) { E(`${what}: evidence path missing`); return; }
    if (!exists(id, ref, p)) E(`${what}: evidence "${p}" does not exist at ${ref}`);
  };

  if (!Array.isArray(model.rows) || model.rows.length < 2) E('needs at least 2 rows');
  const incoming = new Set((model.rows || []).filter((r) => r.trigger && r.trigger.kind === 'external').map((r) => r.trigger.event));
  if (!Array.isArray(model.pivotal) || model.pivotal.length < 2 || model.pivotal.length > 6) E('pivotal needs 2 to 6 event names');
  for (const n of model.pivotal || []) if (!pub.has(n) && !(pub.size === 0 && incoming.has(n))) E(`pivotal event "${n}" is not published by ${id}${pub.size === 0 ? ' (this context publishes none: use incoming events from a row trigger)' : ''}`);

  const onBoard = new Set();
  const aggs = new Set();
  (model.rows || []).forEach((r, i) => {
    const w = `row ${i + 1} "${r.title}"`;
    len(r.title, 'title', `${w} title`);
    len(r.story, 'story', `${w} story`);
    const t = r.trigger;
    if (!t || !KINDS.has(t.kind)) { E(`${w}: trigger.kind must be one of ${[...KINDS]}`); return; }
    if (t.kind === 'actor') len(t.name, 'name', `${w} actor`);
    if (t.kind === 'timer') len(t.name, 'name', `${w} timer`);
    if (t.kind === 'event') { if (!pub.has(t.event)) E(`${w}: trigger event "${t.event}" is not published by ${id}`); }
    if (t.kind === 'external') {
      len(t.event, 'name', `${w} incoming event`);
      if (t.outside) len(t.system, 'name', `${w} outside system`);
      else {
        const prod = CTX.get(t.system);
        if (!prod) E(`${w}: external system "${t.system}" is neither a registry context nor marked outside:true`);
        else {
          const pd = digest(t.system);
          if (!pd.publishes.some((p) => p.name === t.event)) E(`${w}: ${t.system} does not publish "${t.event}"`);
          if (!EDGE.has(`${t.system}>${id}`)) E(`${w}: no event route ${t.system} -> ${id} in facts.edges`);
          if (!d.consumes.some((p) => p.name === t.event || p.typeName === t.event)) W(`${w}: ${id}'s asyncapi does not declare consuming "${t.event}" (drift)`);
        }
      }
    }
    if (t.kind !== 'actor') len(r.policy, 'policy', `${w} policy`);
    else if (r.policy) len(r.policy, 'policy', `${w} policy`);
    for (const x of r.reads || []) len(x, 'read', `${w} reads`);
    for (const x of r.updates || []) len(x, 'read', `${w} updates`);
    if (r.command) {
      len(r.command.name, 'name', `${w} command`);
      if (r.command.operationId) { if (!opIds.has(r.command.operationId)) E(`${w}: operationId "${r.command.operationId}" is not in apis/openapi.yaml`); }
      else if (!['policy', 'timer', 'mcp', 'a2a', 'job'].includes(r.command.via)) E(`${w}: command needs operationId or via: policy|timer|mcp|a2a|job`);
    }
    if (r.aggregate) {
      aggs.add(r.aggregate);
      if (!aggTypes.has(r.aggregate)) E(`${w}: aggregate "${r.aggregate}" is not a type under internal/domain (have: ${[...aggTypes].slice(0, 25).join(', ')})`);
    }
    if ((r.events || []).length && !(r.command && r.aggregate)) E(`${w}: events need a command and an aggregate`);
    for (const e of r.events || []) {
      if (!pub.has(e)) E(`${w}: event "${e}" is not published by ${id} (declared: ${[...pub.keys()].join(', ')})`);
      onBoard.add(e);
    }
    if (t.kind === 'event') onBoard.add(t.event);
    if (!r.command && !(r.updates || []).length && !(r.then || []).length) E(`${w}: a row must do something (command, updates or then)`);
    for (const th of r.then || []) {
      len(th.does, 'does', `${w} then.does`);
      if (th.outside) len(th.system, 'name', `${w} then outside system`);
      else {
        if (!CTX.has(th.system)) E(`${w}: then.system "${th.system}" is neither a registry context nor outside:true`);
        else if (!EDGE.has(`${id}>${th.system}`)) E(`${w}: no event route ${id} -> ${th.system} in facts.edges`);
      }
    }
    if (!Array.isArray(r.evidence) || !r.evidence.length) E(`${w}: evidence[] is required`);
    for (const p of r.evidence || []) evidenceOk(p, w);
  });

  const missing = [...pub.keys()].filter((n) => !onBoard.has(n));
  if (missing.length) E(`events published but not on the board (every published event must appear): ${missing.join(', ')}`);

  for (const [k, what] of [['hotspots', 'hotspot'], ['opportunities', 'opportunity']]) {
    for (const h of model[k] || []) { len(h.text, 'text', what); evidenceOk(h.evidence, what); }
  }
  if (!(model.hotspots || []).length) W('no hotspots (a real board always has some; check the ADRs for "later" decisions)');
  return { errs, warns, stats: { onBoard: onBoard.size, published: pub.size, aggregates: [...aggs] } };
}

// ---------------------------------------------------------------- the big-picture model
function validateEcosystem(eco, models) {
  const errs = [];
  const E = (m) => errs.push(`ecosystem: ${m}`);
  if (!Array.isArray(eco.phases) || eco.phases.length < 5) E('needs at least 5 phases');
  const seen = new Set();
  for (const ph of eco.phases || []) {
    for (const k of ['id', 'title', 'plain']) if (!ph[k]) E(`phase ${ph.id || '?'} missing ${k}`);
    if (!ph.pivotal) E(`phase ${ph.id}: pivotal event required`);
    for (const ev of [...(ph.pivotal ? [ph.pivotal] : []), ...(ph.events || [])]) {
      const d = digest(ev.ctx);
      if (!CTX.has(ev.ctx)) { E(`phase ${ph.id}: unknown context ${ev.ctx}`); continue; }
      if (!d.publishes.some((p) => p.name === ev.name)) E(`phase ${ph.id}: ${ev.ctx} does not publish "${ev.name}"`);
      seen.add(ev.ctx);
    }
    for (const a of ph.actors || []) if (!a.name) E(`phase ${ph.id}: actor without name`);
    for (const s of ph.systems || []) {
      if (!s.name) E(`phase ${ph.id}: system without name`);
      if (s.ctx && !CTX.has(s.ctx)) E(`phase ${ph.id}: system context ${s.ctx} unknown`);
    }
    for (const h of ph.hotspots || []) {
      const m = models[h.ctx];
      if (!m) { E(`phase ${ph.id}: hotspot context ${h.ctx} has no model`); continue; }
      if (!(m.hotspots || [])[h.index]) E(`phase ${ph.id}: ${h.ctx} has no hotspot #${h.index}`);
    }
    for (const o of ph.opportunities || []) {
      const m = models[o.ctx];
      if (!m || !(m.opportunities || [])[o.index]) E(`phase ${ph.id}: ${o.ctx} has no opportunity #${o.index}`);
    }
  }
  const allCtx = [...CTX.keys()];
  const homeless = allCtx.filter((x) => !(eco.phases || []).some((ph) => (ph.contexts || []).includes(x)));
  if (homeless.length) E(`contexts not assigned to any phase: ${homeless.join(', ')}`);
  return errs;
}

// ---------------------------------------------------------------- main
const argv = process.argv.slice(2);
if (process.argv[1] && import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  if (argv[0] === '--digest') {
    const d = digest(argv[1]);
    const uniq = (a) => [...new Set(a)];
    console.log(JSON.stringify({
      id: d.id, ref: d.ref,
      publishes: uniq(d.publishes.map((p) => p.name)).map((n) => (d.publishes.some((p) => p.name === n && !p.analytics) ? n : `${n}  (analytics topic only)`)),
      publishesTopics: uniq(d.publishes.map((p) => p.topic)),
      consumes: d.consumes.map((p) => `${p.from || '?'}: ${p.name}`),
      operations: d.operations.map((o) => `${o.method.toUpperCase()} ${o.path}  [${o.operationId}] ${o.summary}`),
      domainTypes: d.domainTypes.filter((t) => t.kind === 'struct').map((t) => `${t.name} ${t.file}`),
      usecases: d.usecases.map((u) => `${u.name} ${u.file}`),
      adrs: d.adrs,
      kafkaInbound: d.kafkaInbound,
      routesIn: FACTS.edges.filter((e) => e.to === d.id).map((e) => e.from),
      routesOut: FACTS.edges.filter((e) => e.from === d.id).map((e) => e.to),
    }, null, 1));
    process.exit(0);
  }
  if (argv[0] === '--check') {
    const model = JSON.parse(fs.readFileSync(path.resolve(argv[1]), 'utf8'));
    const { errs, warns, stats } = validate(model);
    for (const w of warns) console.log(`warn  ${w}`);
    for (const e of errs) console.log(`ERROR ${e}`);
    console.log(errs.length ? `${errs.length} error(s)` : `ok  ${model.context}: ${stats.onBoard}/${stats.published} published events on the board`);
    process.exit(errs.length ? 1 : 0);
  }

  const files = fs.existsSync(MODELS) ? fs.readdirSync(MODELS).filter((f) => f.endsWith('.json') && f !== 'ecosystem.json') : [];
  const models = {};
  const allErrs = [], allWarns = [];
  for (const f of files) {
    const m = JSON.parse(fs.readFileSync(path.join(MODELS, f), 'utf8'));
    if (m.context !== f.replace(/\.json$/, '')) allErrs.push(`${f}: context field must equal the file name`);
    const { errs, warns } = validate(m, f);
    allErrs.push(...errs); allWarns.push(...warns);
    models[m.context] = m;
  }
  const partial = argv.includes('--partial'); // dev only: render what exists; never commit its output
  const missingModels = [...CTX.keys()].filter((x) => !models[x]);
  if (missingModels.length && !partial) allErrs.push(`no model for: ${missingModels.join(', ')}`);
  const ecoFile = path.join(MODELS, 'ecosystem.json');
  let eco = fs.existsSync(ecoFile) ? JSON.parse(fs.readFileSync(ecoFile, 'utf8')) : null;
  if (!eco && !partial) allErrs.push('model/eventstorming/ecosystem.json is missing');
  else if (eco && !partial) allErrs.push(...validateEcosystem(eco, models));
  if (!eco) eco = { title: '', lede: '', phases: [] };
  for (const w of allWarns) console.log(`warn  ${w}`);
  if (allErrs.length) { for (const e of allErrs) console.error(`ERROR ${e}`); console.error(`${allErrs.length} error(s); data/eventstorming.json not written`); process.exit(1); }

  // counts: everything the page prints comes from here
  const contexts = {};
  const tot = { rows: 0, events: 0, commands: 0, policies: 0, reads: 0, actors: 0, systems: 0, aggregates: 0, hotspots: 0, opportunities: 0, published: 0 };
  for (const [id, m] of Object.entries(models)) {
    const d = digest(id);
    const uniq = (a) => new Set(a).size;
    const ev = uniq(m.rows.flatMap((r) => r.events || []));
    const cmd = uniq(m.rows.map((r) => r.command && r.command.name).filter(Boolean));
    const pol = m.rows.filter((r) => r.policy).length + m.rows.reduce((s, r) => s + (r.then || []).length, 0);
    const rd = uniq(m.rows.flatMap((r) => [...(r.reads || []), ...(r.updates || [])]));
    const act = uniq(m.rows.filter((r) => r.trigger.kind === 'actor').map((r) => r.trigger.name));
    const sys = uniq([...m.rows.filter((r) => r.trigger.kind === 'external').map((r) => r.trigger.system), ...m.rows.flatMap((r) => (r.then || []).map((t) => t.system))]);
    const ag = uniq(m.rows.map((r) => r.aggregate).filter(Boolean));
    const published = uniq(d.publishes.map((p) => p.name));
    // enrich: the REST route behind each command (method + path), read from the contract
    for (const r of m.rows) if (r.command && r.command.operationId) {
      const op = d.operations.find((o) => o.operationId === r.command.operationId);
      if (op) r.command.route = `${op.method.toUpperCase()} ${op.path}`;
    }
    contexts[id] = {
      ...m,
      counts: { rows: m.rows.length, events: ev, commands: cmd, policies: pol, reads: rd, actors: act, systems: sys, aggregates: ag, hotspots: (m.hotspots || []).length, opportunities: (m.opportunities || []).length, published, restOps: d.operations.length, consumed: uniq(d.consumes.map((p) => p.name)) },
      source: {
        ref: d.ref,
        publishedEvents: [...new Set(d.publishes.map((p) => p.name))].sort(),
        analyticsOnly: [...new Set(d.publishes.map((p) => p.name))].filter((n) => d.publishes.every((p) => p.name !== n || p.analytics)).sort(),
        operationIds: d.operations.length,
      },
    };
    tot.rows += m.rows.length; tot.events += ev; tot.commands += cmd; tot.policies += pol; tot.reads += rd; tot.actors += act; tot.systems += sys; tot.aggregates += ag;
    tot.hotspots += (m.hotspots || []).length; tot.opportunities += (m.opportunities || []).length; tot.published += published;
  }
  const bigEvents = new Set(), bigActors = new Set(), bigSystems = new Set();
  let bigHot = 0, bigOpp = 0;
  for (const ph of eco.phases) {
    for (const ev of [ph.pivotal, ...(ph.events || [])]) bigEvents.add(`${ev.ctx}.${ev.name}`);
    for (const a of ph.actors || []) bigActors.add(a.name);
    for (const s of ph.systems || []) bigSystems.add(s.name);
    bigHot += (ph.hotspots || []).length; bigOpp += (ph.opportunities || []).length;
  }
  const out = {
    generatedAt: new Date().toISOString(),
    note: 'Generated by scripts/collect-eventstorming.mjs from model/eventstorming/*.json, proven against origin/develop of each repository. Do not edit by hand.',
    counts: { contexts: Object.keys(contexts).length, ...tot, phases: eco.phases.length, bigEvents: bigEvents.size, bigActors: bigActors.size, bigSystems: bigSystems.size, bigHotspots: bigHot, bigOpportunities: bigOpp },
    ecosystem: eco,
    contexts,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`wrote data/eventstorming.json: ${out.counts.contexts} boards, ${tot.rows} rows, ${tot.events} events, ${tot.commands} commands, ${tot.policies} policies, ${tot.hotspots} hotspots`);
}

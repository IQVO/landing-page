#!/usr/bin/env node
// Collects the architecture assessment: one fitness-function result per project, counted from the
// repositories. Nothing is typed by hand (ADR 0002, ADR 0004).
//
//   node scripts/collect-architecture.mjs             # needs the fetched sibling clones
//   WS_ROOT=/path/to/warehouse-systems node scripts/collect-architecture.mjs
//
// Sources (no network, no token):
//   * git: `origin/<default>` trees of the sibling clones (run `git fetch` first, like the
//     engineering collector). File layout, adapter directories, domain imports, API contracts,
//     event type strings, in-repo fitness tests, ADRs.
//   * data/engineering.json (same day's run): language, group, classification, default branch,
//     LOC by class, CI score. Cross-checked by check.mjs.
// Writes data/architecture.json.
//
// Method: architectural fitness functions (Ford / Parsons / Kua, "Building Evolutionary
// Architectures"; foreword by Martin Fowler, who also keeps the term in his bliki) — objective
// integrity assessments of architectural characteristics, each with a stated target. The framing
// of characteristics -> scenario -> measurable response borrows the utility tree of the SEI's
// ATAM. Every value below is counted; failed checks become the risk lines on the pages.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = process.env.WS_ROOT || path.resolve(HERE, '..', '..');
const OUT = path.resolve(HERE, '..', 'data', 'architecture.json');
const ENG = path.resolve(HERE, '..', 'data', 'engineering.json');
const FACTS = path.resolve(HERE, '..', 'data', 'facts.json');

const git = (repo, ...args) => execFileSync('git', ['-C', path.join(ROOT, repo), ...args], {
  encoding: 'utf8', maxBuffer: 1024 * 1024 * 512, stdio: ['ignore', 'pipe', 'ignore'],
});
const gitOk = (repo, ...args) => { try { return git(repo, ...args); } catch { return null; } };

// ---------------------------------------------------------------- fitness functions
// axes per Ford/Parsons/Kua: scope (atomic|holistic), linkage (static|dynamic),
// trigger (triggered|continual), execution (automated|manual). Ours are all automated.
const FF = {
  layout: {
    name: 'Ports-and-adapters layout', characteristic: 'Structure (separation of concerns)',
    axes: 'atomic · static · triggered · automated',
    target: '>= 95% of source files inside cmd/ or internal/ (Go) or src/ (TypeScript)',
    checks: 'The hexagonal skeleton is where the fleet standard says it is; loose top-level packages erode the boundary.',
  },
  domainPurity: {
    name: 'Domain layer purity', characteristic: 'Coupling (dependency direction)',
    axes: 'atomic · static · triggered · automated',
    target: '0 files under internal/domain importing an adapter or a framework marker',
    checks: 'In hexagonal architecture the domain depends on nothing outward; every framework import in the domain is a dependency-rule violation.',
  },
  adapters: {
    name: 'Adapter symmetry', characteristic: 'Structure (ports and adapters)',
    axes: 'atomic · static · triggered · automated',
    target: 'both inbound/ and outbound/ adapters exist under internal/adapters/',
    checks: 'A service that only talks in, or only talks out, has an asymmetric hexagon; the missing side is usually a hidden dependency.',
  },
  contracts: {
    name: 'Contract-first APIs', characteristic: 'Contracts (interoperability)',
    axes: 'atomic · static · triggered · automated',
    target: '>= 1 OpenAPI and/or AsyncAPI spec under apis/ (or repo root)',
    checks: 'The fleet rule is API-as-product: the spec is the contract, drift-checked in CI. No spec means no checkable contract.',
  },
  events: {
    name: 'Event naming discipline', characteristic: 'Contracts (event-driven integration)',
    axes: 'atomic · static · triggered · automated',
    target: '100% of distinct event types in the AsyncAPI specs match com.warehouse.<sub>.<ctx>.<entity>.<Event>',
    checks: 'CloudEvents 1.0 with a mandated type grammar; a type outside the grammar breaks every consumer that pattern-matches it.',
  },
  fitnessTests: {
    name: 'In-repo architecture tests', characteristic: 'Governance (fitness functions that ship with the code)',
    axes: 'holistic · static · triggered · automated',
    target: '>= 1 *_fitness_test.go under internal/architecture/',
    checks: 'The fleet encodes its own architectural fitness functions as Go tests: catalogue shape, event envelopes, writer topics, MCP authority. Counted, never judged here.',
  },
  adr: {
    name: 'Decision records', characteristic: 'Governance (documented rationale)',
    axes: 'atomic · static · triggered · automated',
    target: '>= 1 architecture decision record',
    checks: 'ADRNNN files under adr/ (docs/adr/ counted too). An architecture that cannot explain its decisions cannot defend them.',
  },
  mcp: {
    name: 'MCP server isolation', characteristic: 'Structure (one context, one MCP surface)',
    axes: 'atomic · static · triggered · automated',
    target: 'a separate cmd/mcp binary when the context declares an MCP server',
    checks: 'ADR 0008 fleet-wide: the MCP surface is its own inbound adapter and its own binary, never a route bolted onto the API.',
  },
  tests: {
    name: 'Test investment', characteristic: 'Evolvability (safety to change)',
    axes: 'atomic · static · triggered · automated',
    target: '>= 0.8 test lines per code line at HEAD',
    checks: 'Same ratio the engineering study scores; repeated here because evolvability is an architectural characteristic, not just hygiene.',
  },
  ci: {
    name: 'CI green', characteristic: 'Delivery (the pipeline as architect)',
    axes: 'holistic · dynamic · triggered · automated',
    target: '>= 90% of decided Actions runs green over the last four ISO weeks',
    checks: 'The only holistic, dynamic fitness function on the page: it watches the system change over time instead of its shape at HEAD.',
  },
};
const FF_ORDER = Object.keys(FF);

// third-party framework markers that must never appear in a domain import (listed on the page)
const FRAMEWORK_MARKERS = [
  'segmentio/kafka-go', 'jmoiron/sqlx', 'labstack/echo', 'gin-gonic', 'gorm.io',
  'jackc/pgx', 'redis/go-redis', 'nats-io', 'google.golang.org/grpc', 'net/http', 'database/sql',
];

const eng = JSON.parse(fs.readFileSync(ENG, 'utf8'));
const facts = JSON.parse(fs.readFileSync(FACTS, 'utf8'));
const CTX = new Map(facts.contexts.map((c) => [c.id, c]));

const SPEC_RE = /(^|\/)apis?\/(openapi|asyncapi)[^/]*\.ya?ml$|^(openapi|asyncapi)\.ya?ml$/i;
const ADR_RE = /(^|\/)(docs\/)?adr\/\d{3,4}-[^/]+\.md$/i;

const evConforming = (t) => {
  const versioned = t.replace(/\.v\d+$/, ''); // a trailing .vN version suffix appears in the fleet's specs and is accepted
  const seg = versioned.split('.');
  if (seg.length < 6) return false;
  if (seg[0] !== 'com' || seg[1] !== 'warehouse') return false;
  if (!/^[A-Z][A-Za-z0-9]*$/.test(seg[seg.length - 1])) return false;
  return seg.slice(2, -1).every((s) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s));
};

const repos = {};
for (const [name, e] of Object.entries(eng.repos)) {
  const ref = `origin/${e.defaultBranch}`;
  const tree = (gitOk(name, 'ls-tree', '-r', '--name-only', ref) || '').split('\n').filter(Boolean);
  const goMod = tree.includes('go.mod');
  const go = goMod || e.language === 'Go';
  const ctx = CTX.get(name) || null;
  const isTs = !go && /\.(ts|tsx|vue|svelte)$/.test(tree.join(' '));

  // ---- layout
  let layout;
  const tsSrcRoot = (root) => {
    const src = tree.filter((p) => /\.(ts|tsx|vue|svelte)$/.test(p) && !/\.(spec|test|d)\.[cm]?tsx?$/.test(p) && !/(^|\/)(tests?|e2e|node_modules|dist|coverage)\//.test(p));
    const inside = src.filter((p) => p.startsWith(`${root}/`));
    return src.length ? {
      unit: `% source files in ${root}/`,
      value: Math.round((100 * inside.length) / src.length), n: src.length,
      stray: src.filter((p) => !p.startsWith(`${root}/`)).slice(0, 8), strayN: src.length - inside.length,
    } : null;
  };
  if (go) {
    const src = tree.filter((p) => p.endsWith('.go'));
    const inside = src.filter((p) => /^(cmd|internal)\//.test(p));
    const outside = src.filter((p) => !/^(cmd|internal)\//.test(p));
    layout = src.length ? {
      unit: '% Go files in cmd/ or internal/',
      value: Math.round((100 * inside.length) / src.length), n: src.length,
      stray: outside.slice(0, 8), strayN: outside.length,
    } : null;
  } else if (isTs) {
    // the repo's chosen source root: whichever of src/ or app/ actually holds files (React Router apps use app/)
    const under = (root) => tree.some((p) => p.startsWith(`${root}/`) && /\.(ts|tsx|vue|svelte)$/.test(p));
    layout = under('src') ? tsSrcRoot('src') : under('app') ? tsSrcRoot('app') : tsSrcRoot('src');
  }

  // ---- domain purity (Go only)
  let domainPurity = null;
  if (go) {
    const module = ((gitOk(name, 'show', `${ref}:go.mod`) || '').match(/^module\s+(\S+)/m) || [])[1] || '';
    // own adapters and third-party frameworks are violations; domain -> domain and domain -> application ports are not
    const markers = module ? [`${module}/internal/adapters`, ...FRAMEWORK_MARKERS] : FRAMEWORK_MARKERS;
    const domainFiles = tree.filter((p) => /^internal\/domain\/.*\.go$/.test(p) && !/_test\.go$/.test(p));
    const violating = [];
    for (const f of domainFiles) {
      const body = gitOk(name, 'show', `${ref}:${f}`) || '';
      const hits = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((imp) => markers.some((mk) => imp.includes(mk)));
      if (hits.length) violating.push({ file: f, imports: [...new Set(hits)].slice(0, 3) });
    }
    domainPurity = {
      value: violating.length, n: domainFiles.length,
      violations: violating.slice(0, 8), strayN: violating.length,
      // own application layer is allowed (domain -> ports), adapters and frameworks are not
      note: 'internal/domain non-test files; own internal/adapters + framework markers counted as violations',
    };
  }

  // ---- adapter symmetry (Go only)
  let adapters = null;
  if (go) {
    const inb = [...new Set(tree.filter((p) => p.startsWith('internal/adapters/inbound/')).map((p) => p.split('/')[3]).filter(Boolean))];
    const outb = [...new Set(tree.filter((p) => p.startsWith('internal/adapters/outbound/')).map((p) => p.split('/')[3]).filter(Boolean))];
    const cmds = [...new Set(tree.filter((p) => /^cmd\/[^/]+\//.test(p)).map((p) => p.split('/')[1]))];
    adapters = { inbound: inb.sort(), outbound: outb.sort(), cmds: cmds.sort() };
  }

  // ---- contracts
  const specs = tree.filter((p) => SPEC_RE.test(p));
  const hasApiSurface = specs.length > 0 || !!ctx;
  const contracts = {
    specs: specs.map((p) => p.replace(/^apis?\//, '')),
    openapi: specs.some((p) => /openapi/i.test(p)),
    asyncapi: specs.some((p) => /asyncapi/i.test(p)),
  };

  // ---- events (from the AsyncAPI specs, the contract source of truth: CloudEvents `type:` declarations)
  let types = [];
  for (const s of specs.filter((p) => /asyncapi/i.test(p))) {
    const body = gitOk(name, 'show', `${ref}:${s}`) || '';
    for (const m of body.matchAll(/^\s*type:\s*["']?(com\.warehouse\.[A-Za-z0-9.-]*[A-Za-z0-9])/gm)) types.push(m[1]);
  }
  types = [...new Set(types)];
  const nonConf = types.filter((t) => !evConforming(t));
  const events = types.length ? { distinct: types.length, conforming: types.length - nonConf.length, nonConforming: nonConf.slice(0, 6), nonConformingN: nonConf.length } : null;

  // ---- in-repo fitness tests (Go only)
  let fitnessTests = null;
  if (go) {
    const files = tree.filter((p) => /^internal\/architecture\/.*_fitness_test\.go$/.test(p));
    let tests = 0;
    if (files.length) {
      const counts = (gitOk(name, 'grep', '-c', '-E', '^func Test', ref, '--', 'internal/architecture') || '');
      tests = counts.split('\n').filter(Boolean).reduce((a, l) => {
        const i = l.lastIndexOf(':'); return a + (Number(l.slice(i + 1)) || 0);
      }, 0);
    }
    fitnessTests = { files: files.length, tests, names: files.map((p) => p.split('/').pop()) };
  }

  // ---- ADRs
  const adrFiles = tree.filter((p) => ADR_RE.test(p));
  const adr = { count: adrFiles.length };

  // ---- MCP isolation
  let mcp = null;
  if (ctx?.mcp && go) mcp = { cmdMcp: tree.some((p) => p.startsWith('cmd/mcp/')), inboundMcp: tree.some((p) => p.startsWith('internal/adapters/inbound/mcp/')) };

  // ---- test investment + CI, from the same day's engineering count
  const codeLoc = e.loc?.code || 0, testLoc = e.loc?.test || 0;
  const tests = codeLoc ? { ratio: Math.round((100 * testLoc) / codeLoc) / 100, code: codeLoc, test: testLoc } : null;
  const ci = e.score?.ci != null ? { pct: e.score.ci, window: e.score.window } : null;

  // ---- assemble: value, target check, applicability
  const R = {};
  const define = (key, applicable, value, pass, detail) => { R[key] = { applicable: !!applicable, value, pass: applicable ? !!pass : null, ...(detail ? { detail } : {}) }; };
  define('layout', !!layout, layout?.value ?? null, (layout?.value ?? 0) >= 95, layout ? { n: layout.n, unit: layout.unit, stray: layout.stray, strayN: layout.strayN } : null);
  define('domainPurity', !!domainPurity, domainPurity?.value ?? null, (domainPurity?.value ?? 1) === 0, domainPurity ? { n: domainPurity.n, violations: domainPurity.violations, note: domainPurity.note } : null);
  define('adapters', !!adapters, adapters ? (adapters.inbound.length && adapters.outbound.length ? 'in+out' : adapters.inbound.length ? 'in only' : adapters.outbound.length ? 'out only' : 'none') : null, !!(adapters?.inbound.length && adapters?.outbound.length), adapters);
  define('contracts', hasApiSurface, contracts.specs.length, contracts.specs.length >= 1, contracts);
  define('events', !!events, events ? (events.distinct ? Math.round((100 * events.conforming) / events.distinct) : null) : null, events ? events.nonConformingN === 0 : null, events);
  define('fitnessTests', !!fitnessTests, fitnessTests?.files ?? null, (fitnessTests?.files ?? 0) >= 1, fitnessTests);
  define('adr', !!ctx || adr.count > 0, adr.count, adr.count >= 1, adr);
  define('mcp', !!mcp, mcp ? (mcp.cmdMcp ? 'cmd/mcp' : mcp.inboundMcp ? 'inbound adapter only' : 'absent') : null, !!mcp?.cmdMcp, mcp);
  define('tests', !!tests, tests?.ratio ?? null, (tests?.ratio ?? 0) >= 0.8, tests);
  define('ci', !!ci, ci?.pct ?? null, (ci?.pct ?? 0) >= 90, ci);

  const keys = FF_ORDER.filter((k) => R[k].applicable);
  const passed = keys.filter((k) => R[k].pass).length;
  repos[name] = {
    group: e.group, language: e.language, classification: e.classification,
    defaultBranch: e.defaultBranch, description: e.description, private: e.private,
    context: ctx ? { id: ctx.id, domain: ctx.domain, kind: ctx.classification, mcp: !!ctx.mcp, a2a: !!ctx.a2a } : null,
    engScore: e.score?.total ?? null,
    ff: R,
    applicable: keys.length, passed, failed: keys.length - passed,
    fitness: keys.length ? Math.round((100 * passed) / keys.length) : null,
  };
  process.stdout.write(`  ${name}: ${keys.length - passed}/${keys.length} failed (${repos[name].fitness}% fit)\n`);
}

// ---------------------------------------------------------------- fleet roll-up
const byFF = Object.fromEntries(FF_ORDER.map((k) => [k, { applicable: 0, pass: 0, fail: 0 }]));
for (const r of Object.values(repos)) {
  for (const k of FF_ORDER) {
    if (!r.ff[k].applicable) continue;
    byFF[k].applicable++; r.ff[k].pass ? byFF[k].pass++ : byFF[k].fail++;
  }
}
const fleet = {
  repos: Object.keys(repos).length,
  evaluated: Object.values(byFF).reduce((a, b) => a + b.applicable, 0),
  passed: Object.values(byFF).reduce((a, b) => a + b.pass, 0),
  failed: Object.values(byFF).reduce((a, b) => a + b.fail, 0),
  byFF,
  fitnessTests: Object.values(repos).reduce((a, r) => a + (r.ff.fitnessTests.detail?.tests || 0), 0),
  fitnessTestFiles: Object.values(repos).reduce((a, r) => a + (r.ff.fitnessTests.detail?.files || 0), 0),
};

const out = {
  generatedAt: new Date().toISOString(),
  note: 'Generated by scripts/collect-architecture.mjs from the repositories. Do not hand-edit.',
  method: { fitnessFunctions: FF, order: FF_ORDER, frameworkMarkers: FRAMEWORK_MARKERS },
  engGeneratedAt: eng.generatedAt,
  fleet, repos,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${fleet.repos} repos, ${fleet.evaluated} fitness-function results, ${fleet.passed} pass, ${fleet.failed} fail, ${fleet.fitnessTests} in-repo fitness tests`);

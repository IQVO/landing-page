#!/usr/bin/env node
// Collects the clean-code assessment: one measured check per project, counted from the
// repositories. Nothing is typed by hand (ADR 0002, ADR 0007).
//
//   node scripts/collect-cleancode.mjs             # needs the fetched sibling clones + go
//   WS_ROOT=/path/to/warehouse-systems node scripts/collect-cleancode.mjs
//
// Sources (no network, no token):
//   * scripts/cleancode_scan.go (run with `go build`): gofmt drift, function length, nesting,
//     file length, exported doc comments, naming, duplicate bodies, debt markers — measured on
//     an extracted `git archive` of each repository's default branch.
//   * git: `git grep` for debt markers in non-Go code files, and Makefile / CI / lint configs
//     for the pipeline checks.
//   * data/engineering.json (same day's run): repo list, groups, classifications.
// Writes data/cleancode.json.
//
// Method: clean code measured, not judged. Robert C. Martin's Clean Code and Fowler's
// Refactoring catalog name the smells (long function, duplicated code, misleading names,
// debt left in comments); here each becomes a counted fact with a stated target. Where a
// fleet gate already exists (make fmt-check, golangci-lint, lefthook), the target IS the
// fleet's own rule. Thresholds were written once from those sources, not fitted to the data.

import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = process.env.WS_ROOT || path.resolve(HERE, '..', '..');
const OUT = path.resolve(HERE, '..', 'data', 'cleancode.json');
const ENG = path.resolve(HERE, '..', 'data', 'engineering.json');
const FACTS = path.resolve(HERE, '..', 'data', 'facts.json');

const git = (repo, ...args) => execFileSync('git', ['-C', path.join(ROOT, repo), ...args], {
  encoding: 'utf8', maxBuffer: 1024 * 1024 * 512, stdio: ['ignore', 'pipe', 'ignore'],
});
const gitOk = (repo, ...args) => { try { return git(repo, ...args); } catch { return null; } };

// ---------------------------------------------------------------- the ten checks
const CC = {
  gofmt: {
    name: 'gofmt-clean tree', characteristic: 'Formatting (one style, machine-enforced)',
    source: "the fleet's own gate: `make fmt-check` fails when `gofmt -l .` prints anything",
    target: '0 files gofmt would rewrite',
    checks: 'Formatting is the cheapest clean-code property: mechanical, total, and already wired into every Makefile and CI run. A file here is a file the gate missed.',
  },
  funcs: {
    name: 'Small functions', characteristic: 'Functions (Clean Code: functions should be small)',
    source: 'measured: named function length in lines, tests and generated files excluded',
    target: '<= 2% of named functions longer than 60 lines',
    checks: 'Clean Code\u2019s first rule of functions is that they should be small; the second is that they should be smaller than that. 60 lines is the stated bar; 2% is the stated tolerance, not a fitted one.',
  },
  nesting: {
    name: 'Flat control flow', characteristic: 'Functions (depth of nesting)',
    source: 'measured: nested if/for/range/switch/select statements; a function literal resets the count',
    target: '0 functions with control flow nested deeper than 4',
    checks: 'Every extra nesting level is another thing a reader (and an agent) must hold in memory. Else-if chains count once; the threshold is the classic four.',
  },
  files: {
    name: 'Small files', characteristic: 'Files (one file, one idea)',
    source: 'measured: non-test Go file line counts, generated files excluded',
    target: '0 non-test files over 800 lines',
    checks: 'Long files mix reasons to change. The fleet\u2019s hexagonal layout gives every file a home; a file past 800 lines has usually outgrown its package.',
  },
  docs: {
    name: 'Documented API surface', characteristic: 'Comments (the API contract in godoc)',
    source: 'measured: exported funcs, types, vars, consts without a doc comment',
    target: '>= 90% of exported symbols carry a doc comment',
    checks: 'Clean Code distrusts comments that repeat the code — but a doc comment on an exported symbol is the contract every other context reads. The fleet\u2019s pinned linter set does not check this; this page is the only place it is counted.',
  },
  naming: {
    name: 'Idiomatic names', characteristic: 'Meaningful names (Go conventions)',
    source: 'measured: exported identifiers containing underscores (scored); package stutter counted, never scored',
    target: '0 exported names with underscores',
    checks: 'MixedCaps, no underscores, is Go\u2019s naming law. The golint stutter rule was evaluated and deliberately not scored: the fleet\u2019s CloudEvents grammar mandates entity-first event names (promise.PromiseMade), which the rule flags by design. Stutter is counted and shown as evidence, not a failure.',
  },
  debt: {
    name: 'No debt markers', characteristic: 'Hygiene (the ledger in the code)',
    source: 'measured: TODO/FIXME/HACK/XXX in comments of code files (AST comments in Go; comment-looking lines elsewhere), tests and fixtures excluded',
    target: '0 debt markers',
    checks: 'A TODO is a promise to a future reader. In a fleet written with AI agents the honest question is whether debt accumulates at all; the counter answers it for every language, not just Go. Markers inside string literals or map keys are data, not debt, and are not counted.',
  },
  dup: {
    name: 'No copy-paste functions', characteristic: 'Duplication (Refactoring: Duplicated Code)',
    source: 'measured: identical function bodies (whitespace and comments stripped) of 5+ lines',
    target: '<= 2% of named functions are exact duplicates',
    checks: 'Fowler\u2019s most cited smell. Exact duplicates across a repo\u2019s cmd/ binaries and adapters (the same newLogger, the same readiness check) are counted per repository; some structural repetition across separate services is by design — each context is its own repo with no shared fleet library.',
  },
  lint: {
    name: 'Lint wired into the pipeline', characteristic: 'Governance (the gate, not the intention)',
    source: 'counted: golangci-lint / eslint / terraform fmt / ruff / hadolint / actionlint in Makefiles, configs and CI workflows',
    target: 'the repository\u2019s linter runs in CI or pre-commit, not only on a willing machine',
    checks: 'A linter that is installed but not wired is a wish. The check reads the Makefile, the lint configs and the workflows and names what it found.',
  },
  hooks: {
    name: 'Pre-commit hygiene', characteristic: 'Governance (the fastest gate)',
    source: 'counted: lefthook.yml with fmt/vet/lint (or equivalent) jobs',
    target: 'lefthook pre-commit runs the fast gates before a commit exists',
    checks: 'The fleet standard is lefthook wrapping the Makefile sensors, so one definition of each gate runs locally and in CI. A repo without hooks relies on remembering.',
  },
};
const CC_ORDER = Object.keys(CC);

const MARKER_PATS = ['*.go', '*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs', '*.py', '*.tf', '*.vue', '*.svelte'];
const MARKER_EXCL = [':!*_test.go', ':!*.spec.ts', ':!*.spec.tsx', ':!*.test.ts', ':!*.test.tsx', ':!*.d.ts',
  ':!tests/', ':!test/', ':!testdata/', ':!vendor/', ':!e2e/', ':!__tests__/', ':!dist/', ':!coverage/', ':!node_modules/'];

// lint-gate tokens read from Makefile / configs / workflows; the first hit per language names the gate
const LINT_TOKENS = ['golangci-lint', 'gofmt', 'fmt-check', 'go vet', 'eslint', 'prettier', 'biome', 'ruff', 'tflint', 'terraform fmt', 'hadolint', 'actionlint', 'node --check', 'eventcatalog-linter'];

const eng = JSON.parse(fs.readFileSync(ENG, 'utf8'));
const facts = JSON.parse(fs.readFileSync(FACTS, 'utf8'));
const CTX = new Map(facts.contexts.map((c) => [c.id, c]));

// build the scanner once (stdlib only; works without a module)
const SCAN_SRC = path.resolve(HERE, 'cleancode_scan.go');
const SCAN_BIN = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cleancode-')), 'cleancode_scan');
execFileSync('go', ['build', '-o', SCAN_BIN, SCAN_SRC], { stdio: 'inherit' });

const repos = {};
const missing = [];
for (const [name, e] of Object.entries(eng.repos)) {
  const ref = `origin/${e.defaultBranch}`;
  const tree = (gitOk(name, 'ls-tree', '-r', '--name-only', ref) || '').split('\n').filter(Boolean);
  if (!tree.length) {
    // a missing clone or a stale fetch must never degrade to "n/a everything": fail the run
    console.error(`  ${name}: no tree at ${ref} — clone missing or not fetched (run git fetch in ${path.join(ROOT, name)})`);
    missing.push(name);
    continue;
  }
  const go = tree.includes('go.mod');
  const ctx = CTX.get(name) || null;
  const hasTs = tree.some((p) => /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/.test(p) && !/(^|\/)(dist|node_modules|coverage)\//.test(p));
  const hasPy = tree.some((p) => p.endsWith('.py') && !/(^|\/)(\.venv|venv|node_modules)\//.test(p));
  const hasTf = tree.some((p) => p.endsWith('.tf'));

  // ---- scan the Go tree (if any)
  let scan = null;
  if (go) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tree-${name.replace(/\//g, '-')}-`));
    try {
      execSync(`git -C ${JSON.stringify(path.join(ROOT, name))} archive ${ref} | tar -x -C ${JSON.stringify(dir)}`, { stdio: ['ignore', 'ignore', 'inherit'] });
      scan = JSON.parse(execFileSync(SCAN_BIN, [dir], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 }));
    } catch (err) {
      console.error(`  ${name}: scan failed: ${err.message?.slice(0, 100)}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // ---- debt markers (Go counted by the scanner; every other language by git grep)
  let markers = scan ? scan.markers.count : 0;
  const markerExamples = scan ? [...scan.markers.examples] : [];
  const grepPats = go ? MARKER_PATS.slice(1) : MARKER_PATS; // .go already counted by the scanner
  const grep = gitOk(name, 'grep', '-I', '-w', '-E', 'TODO|FIXME|HACK|XXX', ref, '--', ...grepPats, ...MARKER_EXCL) || '';
  // debt markers live in comments: git grep cannot parse languages, so keep only lines that
  // look like comments (//, #, /*, *, <!--) and drop matches inside string literals or keys
  const COMMENTY = /^\s*(\/\/|#|\/\*|\*|<!--)/;
  const grepLines = grep.split('\n').filter(Boolean).filter((l) => {
    const i = l.indexOf(':'), j = l.indexOf(':', i + 1);
    return j > i && COMMENTY.test(l.slice(j + 1));
  });
  markers += grepLines.length;
  for (const l of grepLines.slice(0, 6)) {
    const i = l.indexOf(':');
    markerExamples.push(`${l.slice(0, i)}: ${l.slice(i + 1).trim().slice(0, 90)}`);
  }
  const codeFiles = go || hasTs || hasPy || hasTf;

  // ---- pipeline checks: read Makefile, lint configs and workflows for wired gates
  const readAt = (p) => gitOk(name, 'show', `${ref}:${p}`) || '';
  const candidates = ['Makefile', 'package.json', '.golangci.yml', '.golangci.yaml', 'eslint.config.js', 'eslint.config.mjs',
    '.eslintrc.js', '.eslintrc.json', 'pyproject.toml', 'lefthook.yml', ...tree.filter((p) => p.startsWith('.github/workflows/') && (p.endsWith('.yml') || p.endsWith('.yaml')))];
  const found = [];
  for (const f of candidates) {
    if (!tree.includes(f)) continue;
    const body = readAt(f);
    const hits = LINT_TOKENS.filter((t) => body.includes(t));
    if (hits.length) found.push({ file: f, tools: hits });
  }
  const tools = [...new Set(found.flatMap((f) => f.tools))];
  const expected = go ? ['golangci-lint', 'gofmt', 'go vet'] : hasTs ? ['eslint', 'prettier'] : hasPy ? ['ruff'] : hasTf ? ['terraform fmt', 'tflint'] : [];
  const lintPass = expected.length > 0 && expected.some((t) => tools.includes(t))
    || tools.some((t) => ['golangci-lint', 'eslint', 'ruff', 'tflint', 'hadolint', 'actionlint', 'terraform fmt'].includes(t));
  const proseOnly = !codeFiles;

  // ---- pre-commit hooks
  const hasLefthook = tree.includes('lefthook.yml');
  const hookJobs = hasLefthook ? (readAt('lefthook.yml').match(/- name: (\S+)/g) || []).map((s) => s.slice(8)) : [];

  // ---- assemble: value, target check, applicability
  const R = {};
  const define = (key, applicable, value, pass, detail) => { R[key] = { applicable: !!applicable, value, pass: applicable ? !!pass : null, ...(detail ? { detail } : {}) }; };

  if (scan) {
    define('gofmt', true, scan.fmt.neededN, scan.fmt.neededN === 0, { needed: scan.fmt.needed, n: scan.fmt.neededN });
    const share = scan.funcs.count ? (100 * scan.funcs.overN) / scan.funcs.count : 0;
    define('funcs', scan.funcs.count > 0, Math.round(share * 100) / 100, share <= 2, { overN: scan.funcs.overN, count: scan.funcs.count, longest: scan.funcs.longest, over: scan.funcs.over });
    define('nesting', scan.funcs.count > 0, scan.nesting.overN, scan.nesting.overN === 0, { over: scan.nesting.over, maxSeen: scan.nesting.maxSeen });
    define('files', scan.files.go > 0, scan.fileSize.overN, scan.fileSize.overN === 0, { over: scan.fileSize.over, longest: scan.fileSize.longest });
    const docShare = scan.docs.exported ? 100 - (100 * scan.docs.undocumented) / scan.docs.exported : null;
    define('docs', scan.docs.exported > 0, docShare == null ? null : Math.round(docShare), docShare != null && docShare >= 90, { undocumented: scan.docs.undocumented, exported: scan.docs.exported, worst: scan.docs.worst });
    define('naming', scan.files.go > 0, scan.naming.violationsN, scan.naming.violationsN === 0, { violations: scan.naming.violations, stutterN: scan.naming.stutterN, stutter: scan.naming.stutter });
    const dupShare = scan.funcs.count ? (100 * scan.dup.extraN) / scan.funcs.count : 0;
    define('dup', scan.funcs.count > 0, Math.round(dupShare * 100) / 100, dupShare <= 2, { extraN: scan.dup.extraN, count: scan.funcs.count, groups: scan.dup.groups });
  } else {
    for (const k of ['gofmt', 'funcs', 'nesting', 'files', 'docs', 'naming', 'dup']) define(k, false, null, null, null);
  }
  define('debt', codeFiles, markers, markers === 0, { markers, examples: markerExamples.slice(0, 6), scanned: `${grepPats.join(', ')} code files` });
  define('lint', !proseOnly, tools.join(' · ') || null, lintPass, { found, expected: expected.length ? expected : null });
  define('hooks', true, hasLefthook ? 'lefthook' : 'none', hasLefthook, { jobs: hookJobs });

  const keys = CC_ORDER.filter((k) => R[k].applicable);
  const passed = keys.filter((k) => R[k].pass).length;
  repos[name] = {
    group: e.group, language: e.language, classification: e.classification,
    defaultBranch: e.defaultBranch, description: e.description, private: e.private,
    context: ctx ? { id: ctx.id, domain: ctx.domain, kind: ctx.classification, mcp: !!ctx.mcp, a2a: !!ctx.a2a } : null,
    go, scan: scan ? {
      files: scan.files, lines: scan.lines, funcs: scan.funcs.count,
      longFuncs: scan.funcs.overN, undocumented: scan.docs.undocumented, exported: scan.docs.exported,
      stutter: scan.naming.stutterN, dupCopies: scan.dup.extraN, markers: scan.markers.count,
    } : null,
    cc: R,
    applicable: keys.length, passed, failed: keys.length - passed,
    clean: keys.length ? Math.round((100 * passed) / keys.length) : null,
  };
  process.stdout.write(`  ${name}: ${keys.length - passed}/${keys.length} failed (${repos[name].clean}% clean)\n`);
}

// ---------------------------------------------------------------- fleet roll-up
const byCC = Object.fromEntries(CC_ORDER.map((k) => [k, { applicable: 0, pass: 0, fail: 0 }]));
for (const r of Object.values(repos)) {
  for (const k of CC_ORDER) {
    if (!r.cc[k].applicable) continue;
    byCC[k].applicable++; r.cc[k].pass ? byCC[k].pass++ : byCC[k].fail++;
  }
}
const goRepos = Object.values(repos).filter((r) => r.go);
const fleet = {
  repos: Object.keys(repos).length,
  goRepos: goRepos.length,
  evaluated: Object.values(byCC).reduce((a, b) => a + b.applicable, 0),
  passed: Object.values(byCC).reduce((a, b) => a + b.pass, 0),
  failed: Object.values(byCC).reduce((a, b) => a + b.fail, 0),
  byCC,
  goFiles: goRepos.reduce((a, r) => a + r.scan.files.go, 0),
  funcs: goRepos.reduce((a, r) => a + r.scan.funcs, 0),
  longFuncs: goRepos.reduce((a, r) => a + r.scan.longFuncs, 0),
  undocumented: goRepos.reduce((a, r) => a + r.scan.undocumented, 0),
  exported: goRepos.reduce((a, r) => a + r.scan.exported, 0),
  dupCopies: goRepos.reduce((a, r) => a + r.scan.dupCopies, 0),
  stutter: goRepos.reduce((a, r) => a + r.scan.stutter, 0),
  debtMarkers: Object.values(repos).reduce((a, r) => a + (r.cc.debt.applicable ? r.cc.debt.value : 0), 0),
  gofmtFiles: goRepos.reduce((a, r) => a + (r.cc.gofmt.detail?.n || 0), 0),
  hooked: Object.values(repos).filter((r) => r.cc.hooks.pass).length,
};

const out = {
  generatedAt: new Date().toISOString(),
  note: 'Generated by scripts/collect-cleancode.mjs from the repositories. Do not hand-edit.',
  method: { checks: CC, order: CC_ORDER, markerExclusions: MARKER_EXCL.map((x) => x.slice(2)), lintTokens: LINT_TOKENS },
  engGeneratedAt: eng.generatedAt,
  fleet, repos,
};
if (missing.length) {
  console.error(`\nrefusing to write: ${missing.length} repos had no tree (${missing.join(", ")}) — fetch them and re-run`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${fleet.repos} repos (${fleet.goRepos} Go), ${fleet.evaluated} checks, ${fleet.passed} pass, ${fleet.failed} fail, ${fleet.debtMarkers} debt markers, ${fleet.dupCopies} duplicate function copies`);

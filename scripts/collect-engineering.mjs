#!/usr/bin/env node
// Collects the engineering study: per-project quality, pull requests and commits per week and month,
// for every active repository of the IQVO organisation. Nothing in the study is typed by hand (ADR 0002, ADR 0003).
//
//   node scripts/collect-engineering.mjs              # needs the sibling checkouts + a GitHub token
//   WS_ROOT=/path/to/warehouse-systems GH_TOKEN=... node scripts/collect-engineering.mjs
//
// Sources
//   * git: the sibling clones, `origin/<default>` + `origin/main` only (never a working tree; run `git fetch` first).
//     commits, merges, churn by file class, conventional-commit subjects, reverts, co-author trailers,
//     first-parent "landed through a PR" vs direct, tracked lines at HEAD, harness files at HEAD, tags.
//   * GitHub GraphQL: every pull request (size, base/head, author kind, approvals, timestamps).
//   * GitHub REST: every Actions workflow run (queried per week: filtered listings silently cap at 1000) and releases.
// Writes data/engineering.json (committed, so `make build` works without network or token).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = process.env.WS_ROOT || path.resolve(HERE, '..', '..');
const OUT = path.resolve(HERE, '..', 'data', 'engineering.json');
const FACTS = path.resolve(HERE, '..', 'data', 'facts.json');
const ORG = 'IQVO';
const SKIP = new Set(['.github']); // the organisation profile repo: a README, not a project
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN ||
  execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const NOW = new Date();

// ---------------------------------------------------------------- helpers
const DAY = 86400000;
const git = (repo, ...args) => execFileSync('git', ['-C', path.join(ROOT, repo), ...args], {
  encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
});
const gitOk = (repo, ...args) => { try { return git(repo, ...args); } catch { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gh(pathOrUrl, { method = 'GET', body } = {}) {
  const u = pathOrUrl.startsWith('http') ? pathOrUrl : `https://api.github.com${pathOrUrl}`;
  for (let attempt = 0; attempt < 7; attempt++) {
    let r;
    try {
      r = await fetch(u, {
        method, body: body ? JSON.stringify(body) : undefined,
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      });
    } catch (e) { await sleep(1000 * 2 ** attempt); continue; }
    if (r.status === 404 || r.status === 409) return { json: null, next: null };
    if (r.status === 403 || r.status === 429) {
      const reset = Number(r.headers.get('x-ratelimit-reset') || 0) * 1000;
      const wait = r.headers.get('x-ratelimit-remaining') === '0' ? Math.max(reset - Date.now(), 5000) + 2000 : 5000 * (attempt + 1);
      console.warn(`  rate limited on ${u.slice(0, 90)}, waiting ${(wait / 1000).toFixed(0)}s`);
      await sleep(wait); continue;
    }
    if (r.status >= 500) { await sleep(1000 * 2 ** attempt); continue; }
    if (!r.ok) throw new Error(`${method} ${u} -> ${r.status} ${await r.text()}`);
    const next = (r.headers.get('link') || '').split(',').find((p) => p.includes('rel="next"'));
    return { json: await r.json(), next: next ? next.slice(next.indexOf('<') + 1, next.indexOf('>')) : null };
  }
  throw new Error(`gave up on ${u}`);
}
async function paginate(p, pick = (j) => j) {
  const out = []; let next = p;
  while (next) {
    const { json, next: n } = await gh(next);
    if (!json) break;
    const items = pick(json) || [];
    out.push(...items);
    next = items.length ? n : null;
  }
  return out;
}
async function graphql(query, variables) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { json } = await gh('/graphql', { method: 'POST', body: { query, variables } });
    if (json && !json.errors) return json.data;
    console.warn(`  graphql retry: ${JSON.stringify(json && json.errors).slice(0, 200)}`);
    await sleep(2000 * (attempt + 1));
  }
  throw new Error('graphql failed');
}
async function pool(items, n, fn) {
  const results = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; results[k] = await fn(items[k], k); } }));
  return results;
}

// ---- calendar: ISO weeks (Monday, UTC) and calendar months (UTC)
const isoWeek = (d) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear(); const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / DAY + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
};
const monday = (d) => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t; };
const monthOf = (d) => d.toISOString().slice(0, 7);
const ts = (iso) => (iso ? new Date(iso) : null);

// ---- file classes (lockfiles are never counted)
const CLASS_ORDER = ['code', 'test', 'api', 'docs', 'conf', 'gen', 'other'];
// Contract files mirrored into the catalogue and the docs site are copies of the producers' specs: counted as gen.
const MIRRORS = new Set(['ecosystem', 'warehouse-docs']);
function classify(p, repo = '') {
  const s = p.toLowerCase(); const base = s.slice(s.lastIndexOf('/') + 1);
  if (/(^|\/)(go\.sum|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|uv\.lock|cargo\.lock|bun\.lockb)$/.test(s)) return 'lock';
  if (/(^|\/)(fixtures|testdata)\//.test(s)) return 'other';
  if (/(^|\/)static\/(asyncapi|openapi|api)\//.test(s)) return 'gen';
  if (/(^|\/)(vendor|node_modules|dist|build|coverage)\//.test(s) || /(^|\/)gen\//.test(s) || /generated|\.pb\.go$|_gen\.go$|\.gen\.(go|ts)$|zz_generated|\.min\.(js|css)$|\.snap$/.test(s)) return 'gen';
  if (/_test\.go$|\.(spec|test)\.[cm]?[jt]sx?$|\.feature$|(^|\/)test_[^/]*\.py$|_test\.py$|(^|\/)(__tests__|e2e|tests?)\/.*\.(go|[cm]?[jt]sx?|py)$/.test(s)) return 'test';
  if (/(^|\/)(apis?|specs)\/.*\.(ya?ml|json)$|(open|async)api[^/]*\.(ya?ml|json)$/.test(s)) return MIRRORS.has(repo) ? 'gen' : 'api';
  if (/\.(md|mdx|adoc|rst)$/.test(s)) return 'docs';
  if (/\.(go|[cm]?[jt]sx?|py|java|kt|sql|sh|html|css|scss|vue|svelte|rb|rs|c|cc|cpp|h|tf|hcl|tpl|rego|lua)$/.test(s)) return 'code';
  if (/\.(ya?ml|json|toml|ini|env|cfg|conf|mod|properties)$/.test(s) || ['dockerfile', 'makefile', 'containerfile'].includes(base) || /^\.?(lefthook|golangci|gremlins|spectral|editorconfig|gitignore|dockerignore)/.test(base)) return 'conf';
  return 'other';
}
const zeroClasses = () => Object.fromEntries(CLASS_ORDER.map((c) => [c, 0]));

const BOT = /\[bot\]|^dependabot|^github-actions|^renovate/i;
const AI = /claude|anthropic|codex|openai|gpt-|chatgpt|gemini|copilot|cursor|devin|aider|kimi|hermes/i;
const CONVENTIONAL = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert|deps)(\([^)]*\))?!?: \S/;
const REVERT = /^revert\b|^Revert "/i;
const FIX = /^fix(\([^)]*\))?!?: /;
const quant = (arr, q) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const i = (s.length - 1) * q; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

// ---------------------------------------------------------------- 1. repositories + grouping
const facts = JSON.parse(fs.readFileSync(FACTS, 'utf8'));
const DOMAIN_OF = Object.fromEntries(facts.contexts.map((c) => [c.id, c.domain]));
const KIND_OF = Object.fromEntries(facts.contexts.map((c) => [c.id, c.classification]));
const FRONTENDS = new Set(['warehouse-console', 'warehouse-ui-kit', 'warehouse-floor-client', 'storefront-web', 'storefront-bff', 'landing-page']);
const GROUPS = [
  { id: 'wms', label: 'WMS bounded contexts' },
  { id: 'wes', label: 'WES bounded contexts' },
  { id: 'retail-network', label: 'Retail-network bounded contexts' },
  { id: 'storefront', label: 'Storefront bounded contexts' },
  { id: 'frontends', label: 'Frontends and BFFs' },
  { id: 'platform', label: 'Platform, harness and docs' },
];
function groupOf(name, description) {
  if (DOMAIN_OF[name]) return DOMAIN_OF[name];
  if (FRONTENDS.has(name)) return 'frontends';
  const tier = /\b(WMS|WES)-tier\b/i.exec(description || ''); // a context newer than the EventCatalog registry
  if (tier) return tier[1].toLowerCase();
  return 'platform';
}

const orgRepos = (await paginate(`/orgs/${ORG}/repos?per_page=100&type=all`)).filter((r) => !r.archived && !SKIP.has(r.name));
orgRepos.sort((a, b) => a.name.localeCompare(b.name));
const missing = orgRepos.filter((r) => !fs.existsSync(path.join(ROOT, r.name, '.git'))).map((r) => r.name);
if (missing.length) { console.error(`missing clones under ${ROOT}: ${missing.join(', ')}`); process.exit(1); }
console.log(`${orgRepos.length} active repositories`);

// ---------------------------------------------------------------- 2. git
function gitData(r) {
  const name = r.name; const def = r.default_branch;
  const refs = [...new Set([`origin/${def}`, 'origin/main'])].filter((x) => gitOk(name, 'rev-parse', '--verify', '-q', x) !== null);
  const head = `origin/${def}`;
  const commits = []; let cur = null;
  const log = git(name, 'log', '--no-renames', '--numstat', '--format=%x1e%H%x1f%P%x1f%cI%x1f%an%x1f%ae%x1f%s%x1f%(trailers:key=Co-authored-by,valueonly,separator=%x1d)', ...refs);
  for (const line of log.split('\n')) {
    if (line.startsWith('\x1e')) {
      const [h, parents, cdate, an, ae, subject, trailers] = line.slice(1).split('\x1f');
      cur = { h, merge: parents.trim().split(' ').length > 1, d: cdate, an, ae, s: subject, ai: (trailers || '').split('\x1d').some((t) => AI.test(t)), add: zeroClasses(), del: zeroClasses() };
      commits.push(cur);
    } else if (cur && line.includes('\t')) {
      const [a, d, p] = line.split('\t'); const cls = classify(p, name);
      if (cls === 'lock' || a === '-') continue;
      cur.add[cls] += Number(a); cur.del[cls] += Number(d);
    }
  }
  // first-parent of the default branch: did each change land through a pull request?
  const landed = [];
  for (const line of git(name, 'log', '--first-parent', '--format=%P%x1f%cI%x1f%s', head).split('\n').filter(Boolean)) {
    const [parents, d, s] = line.split('\x1f');
    const merge = parents.split(' ').length > 1;
    const viaPr = /^Merge pull request #\d+/.test(s) || /\(#\d+\)\s*$/.test(s);
    landed.push({ d, viaPr, merge });
  }
  // tracked lines at HEAD (text files only; `git grep -I -c ''` counts lines per file)
  const loc = zeroClasses(); let files = 0;
  for (const line of (gitOk(name, 'grep', '-I', '-c', '-e', '', head, '--') || '').split('\n').filter(Boolean)) {
    const rest = line.slice(head.length + 1); const i = rest.lastIndexOf(':');
    const p = rest.slice(0, i); const n = Number(rest.slice(i + 1)); const cls = classify(p, name);
    if (cls === 'lock') continue; loc[cls] += n; files++;
  }
  // harness at HEAD
  const tree = git(name, 'ls-tree', '-r', '--name-only', head).split('\n').filter(Boolean);
  const has = (re) => tree.some((p) => re.test(p));
  const workflows = tree.filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p));
  const harness = {
    makefile: has(/^Makefile$/), lefthook: has(/^lefthook\.ya?ml$/), linter: has(/^(\.golangci\.ya?ml|eslint\.config\.[cm]?js|\.eslintrc[^/]*|biome\.json)$/),
    ci: workflows.length > 0, codeql: workflows.some((p) => /codeql/i.test(p)) || has(/^\.github\/codeql/), scorecard: workflows.some((p) => /scorecard/i.test(p)),
    dependabot: has(/^\.github\/dependabot\.ya?ml$/), bdd: has(/\.feature$/), mutation: has(/^\.?gremlins\.ya?ml$|stryker\.conf|^\.stryker/),
    apiLint: has(/^\.spectral\.ya?ml$/), contract: has(/(^|\/)apis?\/.*(openapi|asyncapi)[^/]*\.ya?ml$|^(openapi|asyncapi)\.ya?ml$/), adr: has(/(^|\/)adr\/\d{3,4}-[^/]+\.md$/),
    agents: has(/^AGENTS\.md$/), dockerfile: has(/^Dockerfile$/), security: has(/^SECURITY\.md$|^\.github\/SECURITY\.md$/),
  };
  const counts = {
    workflows: workflows.length, features: tree.filter((p) => /\.feature$/.test(p)).length,
    adrs: tree.filter((p) => /(^|\/)adr\/\d{3,4}-[^/]+\.md$/.test(p)).length,
  };
  // for-each-ref has no %x escapes: '|' cannot appear in a ref name, so it is a safe separator
  const tags = (gitOk(name, 'for-each-ref', '--format=%(refname:short)|%(creatordate:iso-strict)', 'refs/tags') || '')
    .split('\n').filter(Boolean).map((l) => { const [t, d] = l.split('|'); return { t, d }; });
  return { refs, commits, landed, loc, files, harness, counts, tags };
}

// ---------------------------------------------------------------- 3. GitHub
const PR_QUERY = `query($o:String!,$n:String!,$after:String){repository(owner:$o,name:$n){pullRequests(first:100,after:$after,orderBy:{field:CREATED_AT,direction:ASC}){
  pageInfo{hasNextPage endCursor}
  nodes{number title createdAt mergedAt closedAt isDraft additions deletions changedFiles baseRefName headRefName
    author{login __typename} reviews(states:APPROVED){totalCount}}}}}`;
async function prsOf(name) {
  const out = []; let after = null;
  for (;;) {
    const d = await graphql(PR_QUERY, { o: ORG, n: name, after });
    const c = d.repository.pullRequests; out.push(...c.nodes);
    if (!c.pageInfo.hasNextPage) break; after = c.pageInfo.endCursor;
  }
  return out;
}
// Dependabot's dynamic update jobs get one workflow name per update; fold them into one line.
const workflowName = (x) => {
  if (x.event !== 'dynamic') return x.name;
  if (/^Configured Graph Update/i.test(x.name || '')) return 'Dependency graph (automatic)';
  if (/(github_actions|npm_and_yarn|gomod|go_modules|docker|pip|bundler|cargo|terraform)\b.* in \//.test(x.name || '')) return 'Dependabot updates';
  return x.name;
};
async function runsOf(name, since) {
  const out = [];
  for (let s = monday(since); s < NOW; s = new Date(s.getTime() + 7 * DAY)) {
    const e = new Date(s.getTime() + 7 * DAY - 1000);
    const q = `created=${s.toISOString().slice(0, 19)}Z..${e.toISOString().slice(0, 19)}Z`;
    const runs = await paginate(`/repos/${ORG}/${name}/actions/runs?per_page=100&${q}`, (j) => j.workflow_runs);
    if (runs.length >= 1000) console.warn(`  ${name}: ${q} returned ${runs.length} runs (cap reached, week is a floor)`);
    out.push(...runs.map((x) => ({ w: workflowName(x), e: x.event, b: x.head_branch, sha: x.head_sha, c: x.conclusion, st: x.status, at: x.created_at, up: x.updated_at, start: x.run_started_at })));
  }
  return out;
}
const releasesOf = (name) => paginate(`/repos/${ORG}/${name}/releases?per_page=100`).then((rs) => rs.filter((x) => !x.draft).map((x) => ({ t: x.tag_name, d: x.published_at || x.created_at, pre: x.prerelease })));

// ---------------------------------------------------------------- 4. collect
const raw = await pool(orgRepos, 6, async (r) => {
  const t0 = Date.now();
  const g = gitData(r);
  const since = new Date(Math.min(Date.parse(r.created_at), ...g.commits.map((c) => Date.parse(c.d))));
  const [prs, runs, releases] = await Promise.all([prsOf(r.name), runsOf(r.name, since), releasesOf(r.name)]);
  console.log(`  ${r.name}: ${g.commits.length} commits, ${prs.length} PRs, ${runs.length} runs, ${releases.length} releases (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  return { r, g, prs, runs, releases };
});

// ---------------------------------------------------------------- 5. calendar
const allDates = raw.flatMap(({ g }) => g.commits.map((c) => Date.parse(c.d)));
const START = monday(new Date(Math.min(...allDates)));
const weeks = []; for (let s = START; s <= NOW; s = new Date(s.getTime() + 7 * DAY)) {
  const end = new Date(s.getTime() + 7 * DAY - 1);
  weeks.push({ id: isoWeek(s), start: s.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), partial: end > NOW });
}
const months = []; for (let m = new Date(Date.UTC(START.getUTCFullYear(), START.getUTCMonth(), 1)); m <= NOW; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
  const end = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1) - 1);
  months.push({ id: monthOf(m), label: m.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }), partial: end > NOW, startsMidMonth: false });
}
const firstCommitDay = new Date(Math.min(...allDates));
if (firstCommitDay.getUTCDate() > 1) months[0].startsMidMonth = true;
const weekEnd = Object.fromEntries(weeks.map((w) => [w.id, Date.parse(`${w.end}T23:59:59.999Z`)]));

// ---------------------------------------------------------------- 6. aggregate
// Each period bucket collects raw samples; finalize() reduces them to the published numbers.
const bucket = () => ({
  commits: 0, merges: 0, bot: 0, ai: 0, ccOk: 0, ccN: 0, reverts: 0, fixes: 0, authors: new Set(), add: zeroClasses(), del: zeroClasses(),
  prOpened: 0, prMerged: 0, prClosed: 0, prBot: 0, prRelease: 0, approved: 0, lead: [], size: [],
  runs: 0, ok: 0, fail: 0, cancelled: 0, otherRuns: 0, dur: [], pushes: new Map(), restore: [],
  releases: 0, viaPr: 0, direct: 0, repos: new Set(),
});
function finalize(b) {
  const pushes = [...b.pushes.values()];
  const decided = b.ok + b.fail;
  return {
    commits: b.commits, merges: b.merges, bot: b.bot, ai: b.ai, authors: b.authors.size,
    humanCommits: b.ccN, conventionalOk: b.ccOk, conventional: b.ccN ? r1((100 * b.ccOk) / b.ccN) : null, reverts: b.reverts, fixes: b.fixes,
    add: b.add, del: b.del,
    prOpened: b.prOpened, prMerged: b.prMerged, prClosed: b.prClosed, prBot: b.prBot, prRelease: b.prRelease,
    approvedShare: b.prMerged ? r1((100 * b.approved) / b.prMerged) : null,
    leadMedianH: r1(quant(b.lead, 0.5)), leadP90H: r1(quant(b.lead, 0.9)), leadN: b.lead.length,
    sizeMedian: b.size.length ? Math.round(quant(b.size, 0.5)) : null, smallN: b.size.filter((x) => x <= 400).length, smallShare: b.size.length ? r1((100 * b.size.filter((x) => x <= 400).length) / b.size.length) : null,
    runs: b.runs, ok: b.ok, fail: b.fail, cancelled: b.cancelled, otherRuns: b.otherRuns,
    successRate: decided ? r1((100 * b.ok) / decided) : null, durMedianMin: r1(quant(b.dur, 0.5)),
    pushes: pushes.length, redPushes: pushes.filter((x) => x).length, changeFailRate: pushes.length ? r1((100 * pushes.filter((x) => x).length) / pushes.length) : null,
    restoreMedianH: r1(quant(b.restore, 0.5)), restoreN: b.restore.length,
    releases: b.releases, viaPr: b.viaPr, direct: b.direct, prShare: b.viaPr + b.direct ? r1((100 * b.viaPr) / (b.viaPr + b.direct)) : null,
    activeRepos: b.repos.size,
  };
}
const periodKeys = (iso) => { const d = new Date(iso); return [isoWeek(d), monthOf(d)]; };

const org = { weeks: {}, months: {}, total: bucket() };
const ob = (k) => (k.includes('W') ? (org.weeks[k] ||= bucket()) : (org.months[k] ||= bucket()));
const weekDetail = Object.fromEntries(weeks.map((w) => [w.id, { merged: [], large: [], stale: [], releases: [], red: [], newRepos: [] }]));
const repos = {};

for (const { r, g, prs, runs, releases } of raw) {
  const rw = {}; const rm = {}; const tot = bucket();
  const targets = (iso) => { const [wk, mo] = periodKeys(iso); return [rw[wk] ||= bucket(), rm[mo] ||= bucket(), tot, ob(wk), ob(mo), org.total]; };
  const touch = (iso) => { for (const b of targets(iso)) b.repos.add(r.name); };

  for (const c of g.commits) {
    const bot = BOT.test(c.an) || BOT.test(c.ae);
    for (const b of targets(c.d)) {
      if (c.merge) { b.merges++; continue; }
      b.commits++; b.authors.add(bot ? 'bot' : c.ae.toLowerCase());
      if (bot) b.bot++; else { b.ccN++; if (CONVENTIONAL.test(c.s) || REVERT.test(c.s)) b.ccOk++; }
      if (c.ai) b.ai++;
      if (REVERT.test(c.s)) b.reverts++;
      if (FIX.test(c.s)) b.fixes++;
      for (const k of CLASS_ORDER) { b.add[k] += c.add[k]; b.del[k] += c.del[k]; }
    }
    touch(c.d);
  }
  for (const l of g.landed) {
    if (l.merge && !l.viaPr) continue; // back-merges (main into develop) are bookkeeping, not changes
    for (const b of targets(l.d)) { if (l.viaPr) b.viaPr++; else b.direct++; }
  }

  const prList = [];
  for (const p of prs) {
    const bot = p.author?.__typename === 'Bot' || BOT.test(p.author?.login || '');
    // release PRs (develop -> main) and back-merges (main -> develop) are GitFlow bookkeeping, not changes
    const release = (p.baseRefName === 'main' && p.headRefName === r.default_branch && r.default_branch !== 'main') ||
      (p.headRefName === 'main' && p.baseRefName === r.default_branch) || /(^|\/)back-?merge/i.test(p.headRefName);
    for (const b of targets(p.createdAt)) b.prOpened++;
    touch(p.createdAt);
    const size = p.additions + p.deletions;
    if (p.mergedAt) {
      const leadH = (Date.parse(p.mergedAt) - Date.parse(p.createdAt)) / 3600000;
      for (const b of targets(p.mergedAt)) {
        b.prMerged++; if (bot) b.prBot++; if (release) b.prRelease++;
        if (p.reviews.totalCount > 0) b.approved++;
        if (!bot && !release) { b.lead.push(leadH); b.size.push(size); }
      }
      const wk = isoWeek(new Date(p.mergedAt));
      const row = { repo: r.name, n: p.number, title: p.title, add: p.additions, del: p.deletions, files: p.changedFiles, leadH: r1(leadH), bot, release, at: p.mergedAt };
      weekDetail[wk]?.merged.push(row);
      if (!bot && size > 1000) weekDetail[wk]?.large.push(row);
      prList.push(row);
    } else if (p.closedAt) {
      for (const b of targets(p.closedAt)) b.prClosed++;
    }
    // work in progress left open at the end of each week, older than 7 days
    for (const w of weeks) {
      const end = Math.min(weekEnd[w.id], NOW.getTime());
      const created = Date.parse(p.createdAt); const shut = Date.parse(p.mergedAt || p.closedAt || '9999-12-31');
      if (created <= end && shut > end && end - created > 7 * DAY && !p.isDraft) weekDetail[w.id].stale.push({ repo: r.name, n: p.number, title: p.title, ageD: Math.floor((end - created) / DAY), bot });
    }
  }

  // CI: every run counts for volume and success rate; pushes to the default branch drive the DORA proxies.
  const wfStats = {};
  const pushRuns = [];
  for (const x of runs) {
    const ws = (wfStats[x.w] ||= { name: x.w, runs: 0, ok: 0, fail: 0 }); ws.runs++;
    const durMin = x.up && (x.start || x.at) ? (Date.parse(x.up) - Date.parse(x.start || x.at)) / 60000 : null;
    for (const b of targets(x.at)) {
      b.runs++;
      if (x.c === 'success') b.ok++; else if (x.c === 'failure' || x.c === 'timed_out' || x.c === 'startup_failure') b.fail++; else if (x.c === 'cancelled') b.cancelled++; else b.otherRuns++;
      if (durMin != null && durMin >= 0 && x.st === 'completed' && x.c !== 'skipped') b.dur.push(durMin);
    }
    if (x.c === 'success') ws.ok++; else if (x.c === 'failure' || x.c === 'timed_out') ws.fail++;
    if (x.e === 'push' && (x.b === r.default_branch || x.b === 'main') && x.st === 'completed' && x.c && x.c !== 'skipped' && x.c !== 'cancelled') pushRuns.push(x);
  }
  for (const x of pushRuns) {
    const red = x.c !== 'success';
    for (const b of targets(x.at)) b.pushes.set(`${x.b}@${x.sha}`, (b.pushes.get(`${x.b}@${x.sha}`) || false) || red);
  }
  // time to restore: a workflow goes red on a protected branch -> hours until the same workflow is green again there
  const byWf = {};
  for (const x of [...pushRuns].sort((a, b) => a.at.localeCompare(b.at))) (byWf[`${x.b}|${x.w}`] ||= []).push(x);
  for (const seq of Object.values(byWf)) {
    let redSince = null;
    for (const x of seq) {
      if (x.c !== 'success') { redSince ||= x.at; continue; }
      if (redSince) {
        const h = (Date.parse(x.up || x.at) - Date.parse(redSince)) / 3600000;
        for (const b of targets(redSince)) b.restore.push(h);
        redSince = null;
      }
    }
    if (redSince) { const wk = isoWeek(new Date(redSince)); weekDetail[wk]?.red.push({ repo: r.name, workflow: seq[0].w, branch: seq[0].b, since: redSince }); }
  }
  for (const rel of releases) { for (const b of targets(rel.d)) b.releases++; weekDetail[isoWeek(new Date(rel.d))]?.releases.push({ repo: r.name, tag: rel.t, at: rel.d, pre: rel.pre }); }
  const createdWk = isoWeek(new Date(r.created_at)); weekDetail[createdWk]?.newRepos.push(r.name);

  const fin = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, finalize(v)]));
  const total = finalize(tot);
  const firstCommit = g.commits.length ? g.commits.reduce((a, c) => (c.d < a ? c.d : a), g.commits[0].d) : null;
  const lastCommit = g.commits.length ? g.commits.reduce((a, c) => (c.d > a ? c.d : a), g.commits[0].d) : null;
  repos[r.name] = {
    name: r.name, group: groupOf(r.name, r.description), classification: KIND_OF[r.name] || null,
    description: (r.description || '').replace(/\s*A domain-driven design study, not associated with any company\.?\s*$/i, '').trim(),
    language: r.language, createdAt: r.created_at, defaultBranch: r.default_branch, refs: g.refs, private: r.private,
    firstCommit, lastCommit, total, weeks: fin(rw), months: fin(rm),
    loc: g.loc, files: g.files, harness: g.harness, harnessCounts: g.counts,
    tags: g.tags.length, lastTag: g.tags.sort((a, b) => (b.d || '').localeCompare(a.d || ''))[0]?.t || null,
    releases: releases.sort((a, b) => b.d.localeCompare(a.d)).slice(0, 12),
    workflows: Object.values(wfStats).sort((a, b) => b.runs - a.runs).slice(0, 12),
    recentMerged: prList.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12),
  };
}

// ---------------------------------------------------------------- 7. scorecard (last four ISO weeks + HEAD)
// Seven signals, each scored 0..100 against a stated target; a signal with no data is null and drops out of the mean.
// The window is the last four ISO weeks including the current one to date, so a young repository is scored on what exists.
const trailing = weeks.slice(-4).map((w) => w.id);
const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));
for (const rp of Object.values(repos)) {
  // re-sum the trailing weeks from counts (never average the weekly ratios)
  let ok = 0, fail = 0, pushes = 0, red = 0, via = 0, direct = 0, ccN = 0, ccOk = 0, small = 0, sized = 0;
  for (const wk of trailing) {
    const w = rp.weeks[wk]; if (!w) continue;
    ok += w.ok; fail += w.fail; pushes += w.pushes; red += w.redPushes; via += w.viaPr; direct += w.direct;
    ccN += w.humanCommits; ccOk += w.conventionalOk; small += w.smallN; sized += w.leadN;
  }
  const testRatio = rp.loc.code ? rp.loc.test / rp.loc.code : null;
  const h = rp.harness; const checklist = Object.values(h);
  const signals = {
    ci: ok + fail ? clamp((100 * ok) / (ok + fail)) : null,                       // target: every decided run green
    stability: pushes ? clamp(100 - (100 * red) / pushes) : null,                 // target: no red push on develop/main
    flow: via + direct ? clamp((100 * via) / (via + direct)) : null,              // target: every change lands through a PR
    batch: sized ? clamp((100 * small) / sized) : null,                           // target: every PR <= 400 changed lines
    tests: testRatio == null ? null : clamp((100 * testRatio) / 0.8),             // target: >= 0.8 test lines per code line
    hygiene: ccN ? clamp((100 * ccOk) / ccN) : null,                              // target: conventional commit subjects
    harness: clamp((100 * checklist.filter(Boolean).length) / checklist.length),  // target: the full harness checklist
  };
  const vals = Object.values(signals).filter((v) => v != null);
  rp.score = { ...signals, total: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null, testRatio: testRatio == null ? null : Math.round(testRatio * 100) / 100, window: trailing };
}

// ---------------------------------------------------------------- 8. write
for (const d of Object.values(weekDetail)) {
  d.merged.sort((a, b) => a.at.localeCompare(b.at));
  d.large.sort((a, b) => b.add + b.del - (a.add + a.del));
  d.stale.sort((a, b) => b.ageD - a.ageD);
  d.releases.sort((a, b) => a.at.localeCompare(b.at));
}
const finAll = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, finalize(v)]));
const outRepos = Object.fromEntries(Object.entries(repos).sort(([a], [b]) => a.localeCompare(b)));
const out = {
  generatedAt: NOW.toISOString(),
  note: 'GENERATED by scripts/collect-engineering.mjs. Do not edit by hand. Weeks are ISO weeks (Monday, UTC); months are calendar months (UTC).',
  org: ORG, scope: { repos: Object.keys(outRepos).length, skipped: [...SKIP] },
  weeks, months, trailing, classes: CLASS_ORDER, groups: GROUPS,
  total: finalize(org.total), orgWeeks: finAll(org.weeks), orgMonths: finAll(org.months), weekDetail, repos: outRepos,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 0) + '\n');
console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${out.scope.repos} repos, ${weeks.length} weeks, ${months.length} months, ` +
  `${out.total.commits} commits, ${out.total.prMerged} merged PRs, ${out.total.runs} CI runs (${(fs.statSync(OUT).size / 1024).toFixed(0)} KiB)`);

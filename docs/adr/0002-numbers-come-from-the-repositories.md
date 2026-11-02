# ADR 0002: Every figure on the page is counted from the repositories by a script

Status: accepted. Date: 2026-11-02.

## Context

A page that argues for honesty about AI usage cannot carry numbers typed from memory. The fleet moves daily: contexts are added,
ADRs accumulate, models change. Hand-typed counts drift, and a landing page with a wrong number is worse than one with none.

## Decision

- `scripts/collect-facts.mjs` computes every figure and the event map, and writes `data/facts.json` (committed, never hand-edited).
- Sources, all read through `git show origin/develop:` (or `origin/main`), never a working tree:
  - contexts, domain, classification, purpose, published topics: `ecosystem/catalog.contexts.mjs` (the registry the EventCatalog uses);
  - event routes: a publisher's topic matched against every other context's `apis/asyncapi.yaml` channels (AsyncAPI 2 keys and AsyncAPI 3 `address:`);
  - MCP servers and A2A agents: presence of `cmd/mcp` and `cmd/a2a`;
  - ADRs: files named `NNNN-*.md` under `docs/adr`, `docs/docs/adr` or `adr`;
  - commits and AI co-author trailers: `git log --all` across every checked-out repo, de-duplicated by hash;
  - incidents and fitness tests: `warehouse-harness-template` (`INCIDENTS.md` rows, `func Test` in `internal/architecture`);
  - public repository count: `gh api orgs/IQVO` (skipped when `gh` is unavailable).
- `scripts/build.mjs` fails on an unresolved placeholder; `scripts/check.mjs` fails when counts disagree with each other or with the map.
- AI usage is stated only as what git can prove. `Co-Authored-By: Claude …` trailers are counted per model and presented as a floor,
  never as a share of the work. Models that leave no trailer (an orchestrator model, for example) are named without a count.
- Claims about the harness (incidents, guards, evaluation results) are paraphrased from `INCIDENTS.md`, `HARNESS.md` and `EVALS.md`,
  including the null results, and link back to them.

## Consequences

- Refreshing the page is `make facts && make check`; a stale `facts.json` (over 45 days) warns in `check`.
- The collector needs the sibling repositories fetched next to this one. The build does not: it only needs the committed JSON.
- Trailer counts under-count AI work, and the page says so. That is deliberate.
- Hand-written prose can still go stale (for example the incident descriptions in the Harness section). Those are copied text, with
  the date and the guard test named so a reader can verify them.

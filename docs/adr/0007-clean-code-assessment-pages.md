# ADR 0007: Clean-code assessment pages under /cleancode/

- **Status**: Accepted
- **Date**: 2026-11-22
- **Context**: ADR 0004 assesses each project's *architecture* (structure, coupling, contracts,
  governance). The complementary question — is the *code itself* clean? — had no fleet-wide
  answer: the repos run gofmt/vet/golangci-lint gates, but nothing measures the properties those
  gates do not check (function size, nesting, file size, doc comments on exported symbols,
  duplication) or whether the gates are wired at all in the non-Go and tooling repositories.
- **Decision**: Add a clean-code assessment at `/cleancode/`, generated like the architecture
  assessment: a collector (`scripts/collect-cleancode.mjs`, `git` trees of `origin/<default>` +
  the same day's `data/engineering.json`, no network) writes `data/cleancode.json`;
  `scripts/cleancode.mjs` renders one overview and one page per project inside `build.mjs`.
  The method is Martin's *Clean Code* / Fowler's *Refactoring* smells turned into counted facts:
  smell → check → stated target. Ten checks: gofmt-clean tree, small functions, flat control
  flow, small files, documented API surface, idiomatic names, no debt markers, no copy-paste
  functions, lint wired into the pipeline, pre-commit hygiene. Seven are measured by
  `scripts/cleancode_scan.go` (stdlib Go: `go/parser`, `go/ast`, `go/format`) on an extracted
  `git archive` of each Go repository; three are counted from git (grep for markers, Makefiles /
  configs / workflows for the pipeline checks). Every value is counted; a missed target is a
  finding with its evidence; non-applicable checks are published as n/a, never silently dropped.
- **Thresholds** come from the fleet's own gates where they exist (`make fmt-check` is
  literally `gofmt -l .` empty; lefthook wrapping the Makefile sensors is the harness standard)
  and are stated once otherwise (60-line functions at ≤ 2%, nesting ≤ 4, files ≤ 800 lines,
  ≥ 90% documented exported symbols, duplicate bodies ≤ 2% of functions). They were not fitted
  to the data. Two deliberate judgment calls, documented on the method page: tests are excluded
  from every size check (table-driven tests legitimately run long), and golint's stutter rule is
  *counted but never scored* because the fleet's CloudEvents grammar mandates entity-first event
  names (`promise.PromiseMade`) that the rule flags by design.
- **Consequences**: `make cleancode` refreshes the assessment (needs `go` on PATH and the
  fetched sibling clones; a missing clone fails the run instead of silently scoring n/a).
  `check.mjs` gates the 58 pages like the architecture pages (banner, disclaimer, per-project
  h1, pass/fail arithmetic, fleet roll-ups recomputed, cross-file agreement with
  `engineering.json`, the landing band's counts equal to the data) and gives `/cleancode/` its
  own size budget (2 MB total, 120 KiB per page). The landing page gains a § 09 band, a nav
  link, a reports-list entry and a footer link. Blind spots are stated, not hidden: the scanner
  is syntactic (no type information, no cyclomatic complexity, no semantic duplication) and the
  pipeline checks read the wiring, they do not run it.

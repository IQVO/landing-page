# ADR 0004: Architecture assessment pages under /architecture/

- **Status**: Accepted
- **Date**: 2026-11-10
- **Context**: ADR 0003 shipped the engineering study (delivery and quality). The complementary
  question — is each project's *architecture* still the architecture it claims? — was answered only
  by each repository's own in-repo fitness tests, with no fleet-wide view.
- **Decision**: Add an architecture assessment at `/architecture/`, generated the same way as the
  engineering study: a collector (`scripts/collect-architecture.mjs`, git trees of
  `origin/<default>` + the same day's `data/engineering.json`, no network) writes
  `data/architecture.json`; `scripts/architecture.mjs` renders one overview and one page per
  project inside `build.mjs`. The method is Ford / Parsons / Kua fitness functions ("objective
  integrity assessment of an architectural characteristic", *Building Evolutionary Architectures*,
  foreword by Martin Fowler), organised characteristic → check → target after the SEI ATAM utility
  tree. Ten functions: layout, domain purity, adapter symmetry, contracts, event grammar, in-repo
  architecture tests, ADRs, MCP isolation, test investment, CI green. Every value is counted; a
  missed target is a risk line on the project page; non-applicable checks are published as n/a,
  never silently dropped.
- **Thresholds** come from the fleet's own standards (ADR 0008's `cmd/mcp`, the CloudEvents type
  grammar, the 0.8 test:code target shared with the engineering study) and were written once, not
  fitted to the data. The page says what it cannot do: no ATAM tradeoff points, no runtime
  measurement beyond CI.
- **Consequences**: `make architecture` refreshes the assessment (fast: git only). `check.mjs`
  gates the 53 pages like the engineering pages (banner, disclaimer, per-project h1, pass/fail
  arithmetic, cross-file agreement with `engineering.json`) and gives `/architecture/` its own size
  budget so the landing budget stays untouched. The landing page gains a § 08 band and links from
  the docs list and the footer.

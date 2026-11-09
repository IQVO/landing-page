# ADR 0003: A generated engineering study, one page per project and one report per week

Status: accepted. Date: 2026-11-08.

## Context

The landing page says the fleet is built by AI agents behind a harness that can say no. Whether that harness holds is a
software-engineering question: how much lands, how fast, how often CI goes red, how quickly it recovers, how big the batches are,
whether tests grow with the code. The owner asked for a study of every project (quality, pull requests and commits per month) and
a software-engineering report per week, published from the landing page.

## Decision

- The study is static HTML under `/engineering/`, rendered by `scripts/engineering.mjs` during `make build` from
  `data/engineering.json`. Same nginx image, same strict CSP, no JavaScript: charts are inline SVG with geometry in attributes.
  - `/engineering/`: fleet KPIs, months, weeks, every project by month, the scorecard and the method.
  - `/engineering/weeks/<YYYY-Www>/`: one report per ISO week (DORA-style proxies, flow, quality, risks left open, every merged PR).
  - `/engineering/projects/<repo>/`: one study per active repository.
- `scripts/collect-engineering.mjs` writes `data/engineering.json` (committed, never hand-edited), following ADR 0002:
  - git from the sibling clones, `origin/<default>` plus `origin/main`, never a working tree;
  - GitHub GraphQL for pull requests; GitHub REST for Actions runs (queried one week at a time because filtered listings stop at
    1,000) and releases. It needs a token (`GH_TOKEN` or `gh auth`); the build does not.
- Metrics are named as proxies and each has a stated source and blind spot on the page. Lead time is PR open to merge, deployment
  frequency is published releases, change failure is the share of pushes to develop/main with a red workflow, time to restore is
  red to green for the same workflow on the same branch. Release PRs and back-merges are excluded from lead time and batch size.
- The quality score is the mean of seven 0-100 signals against stated targets (CI success, branch stability, changes through PRs,
  small batches, test lines per code line, Conventional Commits, harness checklist). A signal without data is left out, never zero.
- Every study page carries the pinned study-project banner and the verbatim fleet disclaimer; `check.mjs` enforces it, and checks
  that per-project, per-month and per-week totals add up to the fleet totals.
- The landing page keeps its own size budget; the study has a separate one (4 MB of HTML in total, 250 KB per page).

## Consequences

- Refreshing is `make engineering && make check`, then a release. `check` warns when the study is more than 8 days old, because the
  latest weekly report goes stale first.
- The current ISO week and month are partial and marked "in progress" / "to date"; a refresh replaces them.
- Approvals are near zero by construction (one maintainer, CI as the gate). The study reports that and does not score review.
- Contract files mirrored into `ecosystem` and `warehouse-docs` count as generated copies, not as API work, so the fleet's contract
  lines are not counted three times.

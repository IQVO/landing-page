# HARNESS.md — landing-page

What agent harness this repo has, what each piece runs, and when. Model (from
`warehouse-harness-template`, after Böckeler, "Harness engineering for coding agent users"):
**guides** steer an agent before it acts (feedforward), **sensors** report after it acts (feedback);
each is **computational** (deterministic) or **inferential** (LLM). This is a static page on nginx,
not a Go bounded context: there is no coverage gate, arch-test, bdd, mutation, api-lint,
docs-api-drift or helm chart here. Only what is listed below exists.

harness-template: v4

## Guides (feedforward)

| File | Type | Purpose |
|---|---|---|
| `CLAUDE.md` (`AGENTS.md` is a symlink to it) | computational | Entry point: the nine hard constraints (nginx only, self-contained CSP, no hand-typed numbers, honest AI claims, fleet facts, brand, docs links, accessibility, assets never through Kong), commands, layout. |
| `.claude/rules/nginx-static-assets.md` | computational | Scoped to `deploy/**`, `Dockerfile`, the asset build and the smoke test: routing, caching, header includes, CSP. |
| `.claude/agents/*.md` | inferential | `code-review`, `architecture-review`, `domain-review` subagents (template-managed). |
| `.claude/memory/MEMORY.md` | computational | Durable repo heuristics that are not incidents. |
| `docs/adr/` | computational | 0001 static HTML on nginx, 0002 numbers come from the repositories, 0003 engineering study pages. |
| `INCIDENTS.md` | computational | Fleet incident log: every escape with its fix and the sensor that now guards it. |

## Sensors (feedback)

| Sensor | Where | What it runs | Lifecycle | Blocking? |
|---|---|---|---|---|
| lefthook pre-commit | `lefthook.yml` | `node --check` on staged JS, `hadolint Dockerfile`, `actionlint` on staged workflows | commit (after `lefthook install`) | yes (local) |
| lefthook pre-push | `lefthook.yml` | `make check` | push | yes (local) |
| `guide-lint` | `.github/workflows/ci.yml` | `guide_lint.py` (skills load, cited paths and `make` targets exist, context budget), `repo_lint.py` (workflow paths, `needs:`, Dependabot, stale owner, placeholders), `test_hook.py`, `test_red_issue.py`, `test_repo_lint.py` | PR + push to develop/main | yes |
| `check` | ci.yml | `make check`: build `dist/`, then `scripts/check.mjs` (links, ids, a11y basics, strict CSP, size budget, facts consistency, verbatim disclaimer) | PR + push | yes |
| `image` | ci.yml | `make docker-test`: build the image, run it read-only, `scripts/smoke.sh` (non-root, headers, immutable hashed assets, gzip, 404/405, relative redirect, `/healthz`) | PR + push | yes |
| `trivy-scan` | ci.yml | image build + Trivy (SARIF upload) | PR into main | yes |
| CodeQL | `.github/workflows/codeql.yml` | JavaScript analysis | PR, push, weekly | yes |
| Scorecard | `.github/workflows/scorecard.yml` | supply-chain hygiene | push to develop, weekly | no |
| AI review | `.github/workflows/ai-review.yml` | needs `ANTHROPIC_API_KEY`; path filter `internal/domain`, `apis`, `charts`, none of which exist here, so it does not fire | PR into develop | no (advisory) |
| Online link check | `make check-online` | the gate plus a HEAD on every external link | by hand | no |

`docker-publish` and `release` run only on push to main (GHCR publish); they are delivery, not sensors.

Local gates: `make check` (= `make check-fast` = `make check-all`; the agent Stop hook runs it when code
changed), `make docker-test`, `make guide-lint`, `make harness-test`.

## Agent runtime harness

| Piece | Files | Lifecycle |
|---|---|---|
| Guard + feedback hooks | `scripts/harness/hook.py` (`pre` / `post` / `stop`) with adapters `.claude/settings.json`, `.codex/hooks.json`, `.opencode/plugins/harness.ts` | every tool call; end of turn |
| Skills for Codex | `.agents/skills` symlink to `.claude/skills` (no repo skills yet) | on task match |
| Red-sensor helper | `scripts/harness/red_issue.py` (tested; no scheduled job here calls it yet) | n/a |

The hooks block pushes to develop/main, `--no-verify`, force-push, bare `rm -rf` on non-scratch
paths, destructive git, and edits to generated files; the Stop hook runs `make check-fast` when code
changed. `HARNESS_OFF=1` disables them. The `scripts/harness/*.py` files and the three adapters are
template-managed copies: change them in `warehouse-harness-template`, never here.

## Incident protocol

Every failure that was not caught before CI ends with the fix, a sensor or guide that would have
caught it, that sensor rolled out fleet-wide, and a row in [INCIDENTS.md](INCIDENTS.md). A row with
no guard is an open gap and says so.

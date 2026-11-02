# Project: landing-page (IQVO public landing page)

Static site, served by nginx. Explains IQVO as a Domain-Driven Design study and an open experiment in AI agents, persistent
memory and harness engineering across different LLMs. Part of the IQVO / warehouse-systems estate but not a bounded context:
no domain model, no API, no Kafka, no database.

> **Study project.** Not production, not a product, not affiliated with any company. The disclaimer text in the footer and in
> README.md is fleet-standard and verbatim: do not reword it.

## Commands

- `make check`: build + gate (`scripts/check.mjs`). Run before saying "done".
- `make facts`: recount every number and the map from the sibling repos (reads `origin/develop` via `git show`). Then `make check`.
- `make serve`: preview on http://localhost:4173.
- `make docker-test`: build the nginx image and smoke-test it (read-only rootfs, non-root, headers, caching, 404/405, health).

## Hard constraints

1. **Deploy target is nginx. Never GitHub Pages, never Docusaurus.** CI verifies only. Do not add a Pages/deploy workflow.
2. **Self-contained.** No third-party request of any kind (no CDN fonts, analytics, embeds). The CSP is
   `default-src 'none'` + `'self'`: no inline `<script>`, no `style="…"` attribute in markup. Set styles from JS through
   `element.style` / `setProperty` (allowed), or add a class.
3. **No hand-typed numbers.** Anything countable is a `{{placeholder}}` filled from `data/facts.json`, which only
   `scripts/collect-facts.mjs` writes. A new figure means a new field in the collector first (ADR 0002).
4. **Honest AI claims.** State only what git or the repos can show. Co-author-trailer counts are a floor, never a share. Name models
   that leave no trailer without a count. Publish null results as null. Do not invent benchmarks, customers, quotes or metrics.
5. **Fleet facts stay true.** REST and MCP are unauthenticated fleet-wide by decision (say so; never describe auth as current).
   Storefront contexts are "built on develop, not deployed", never "running". One Kafka broker, single-node kind cluster.
6. **Logo and palette.** The logo is the IQVO avatar from github.com/IQVO (navy hexagon, mint blocks, dark-navy wordmark). Use
   `iqvo-logo.png` on light surfaces only; do not recolour or redraw it. The old orange "A" logo in `ecosystem/public` is not IQVO's.
   Palette tokens live at the top of `main.css`; amber is the single non-logo signal colour.
7. **Docs links** go through `{{docs}}` (from `site.config.json` / `DOCS_URL`), per-context pages follow
   `contexts/<id>` (WMS/WES), `network/contexts/<id>`, `storefront/contexts/<id>`. Verify with `node scripts/check.mjs --online`.
8. **Accessibility is a gate, not a polish step:** AA contrast, visible focus, 44 px touch targets on coarse pointers, reduced
   motion honoured, content readable without JS, keyboard-operable map and tabs.

## Layout

See README.md "Architecture". Template: `src/index.html`; tokens + all CSS: `src/assets/css/main.css`; behaviour:
`src/assets/js/{app,map,swap}.js`.

## When editing copy

Each section has a source of truth (README "Documentation" table). If you paraphrase an incident or an eval result, keep the
date and the guard test name so a reader can verify it, and keep the caveats ("one repo, one model, small n").

# ADR 0006: EventStorming section and boards under /eventstorming/

- **Status**: Accepted
- **Date**: 2026-11-13
- **Context**: The landing page explained the study (experiment, models, harness, memory) and
  measured it (engineering, architecture, briefings), but never showed the domain itself in the
  notation the study is built on. EventStorming (Alberto Brandolini) is that notation: orange
  events on a timeline, then the commands, actors, policies, read models, aggregates and external
  systems that cause them. The ask: a section called EventStorming, a big picture of the whole
  ecosystem, then a board for every bounded context, in the official sticky colours, easy to
  understand.
- **Decision**: Add § 10 EventStorming to the landing page (the nine colours, one real row, the
  counts, links) and `/eventstorming/`: a hub (what EventStorming is, the three levels, the
  colours, the **big picture** wall of ten phases that touches all contexts, how to read a row,
  the index of boards, how it was made) plus **one board per bounded context** at
  `/eventstorming/contexts/<id>/` (pivotal events, then every row: trigger, rule or facts,
  command, aggregate, events, who reacts next; then hot spots and opportunities).
- **Notation** (ddd-crew EventStorming glossary and cheat sheet, CC BY 4.0): orange event, blue
  command, small yellow actor, big pale yellow aggregate (the glossary now calls it a constraint),
  lilac policy, green read model, wide pink external system, neon-pink tilted hot spot, dark-green
  opportunity. Colour is never the only cue: every sticky carries its type as a word. Citations of
  the method stay textual (Brandolini's book and 2013 article); the only link is the ddd-crew
  repository on github.com.
- **A reconstruction, not a workshop**: the boards are rebuilt from the repositories and say so
  on every page. Sources of truth: events from each context's AsyncAPI, commands from its OpenAPI,
  aggregates from `internal/domain`, policies and read models from the Kafka consumers and use
  cases, hot spots and opportunities from ADRs and docs that state the gap or the plan.
- **Models are data, proven by a script**: `model/eventstorming/<context>.json` (hand-authored,
  one per context, plus `ecosystem.json` for the big picture) is validated by
  `scripts/collect-eventstorming.mjs` against `origin/develop` of every sibling repository and
  written to `data/eventstorming.json`. The script fails when a board names an event the context
  does not publish, leaves one out (every published event must appear, analytics-only included),
  names an `operationId` or aggregate that does not exist, draws a reaction with no real event
  route in `facts.edges`, cites an evidence file that does not exist, or when a context has no
  board or no phase on the big picture. `--digest <ctx>` prints what the sources say about one
  context (for authors); `--check <file>` validates one model. A model whose consumer is not
  declared in the consumer's own AsyncAPI is a *warning* (documentation drift), not an error.
- **Counts**: nothing on the pages is typed by hand; every figure comes from
  `data/eventstorming.json` (ADR 0002). The landing section and the hub print the same counts and
  `check.mjs` asserts it.
- **Consequences**: `make eventstorming` refreshes the data (needs fetched sibling checkouts;
  about a minute cold, seconds warm: per-commit results are cached under the OS temp dir).
  `check.mjs` gates the 39 pages (banner, disclaimer, anchors, nine legend colours, one phase per
  entry, every published event drawn on its board, every row and hot spot present, counts that add
  up) and gives them their own size budget. The landing CSS budget rises from 70 to 90 KiB for
  `es.css` (the sticky notation). The primary nav gets one more link, so link padding and font
  size shrink slightly and the Documentation button reads "Docs" to keep the nav inside 1440 px.
- **Alternatives rejected**: SVG boards (text does not wrap, no copy, poor a11y); a diagram per
  context hand-drawn in Mermaid (not provable); reusing each repository's `eventstorming.md`
  (stale in many places: the authoring pass recorded contradictions between those pages and the
  code in nearly every context).

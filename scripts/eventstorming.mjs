// Renders the EventStorming pages (data/eventstorming.json) into landing-template pages under dist/eventstorming/.
//   /eventstorming/                     the hub: what EventStorming is, the colours, the BIG PICTURE of the whole ecosystem,
//                                       how to read a row, an index of every board
//   /eventstorming/contexts/<id>/       one board per bounded context (process + design level, reconstructed from code)
// Notation: Alberto Brandolini's EventStorming (official sticky colours, ddd-crew glossary). Every sticky was proven against
// the repository sources by scripts/collect-eventstorming.mjs; every figure here is counted from that data.
// No JavaScript. No inline styles. Sticky colours live in src/assets/css/es.css.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const FACTS = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'data', 'facts.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('en-US');
const n = (x) => (x == null ? '—' : nf.format(x));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const plural = (k, one, many) => `${n(k)} ${k === 1 ? one : (many || `${one}s`)}`;

const PROGRAMS = {
  wms: { label: 'Warehouse management (WMS)', short: 'WMS', blurb: 'What is held where, in what state, and how it gets in.', docs: (id) => `contexts/${id}` },
  wes: { label: 'Warehouse execution (WES)', short: 'WES', blurb: 'Planning, releasing and executing the work on the floor.', docs: (id) => `contexts/${id}` },
  'retail-network': { label: 'Retail network', short: 'Retail', blurb: 'Offers, promises, orders, sourcing and the parcel network.', docs: (id) => `network/contexts/${id}` },
  storefront: { label: 'Digital storefront', short: 'Storefront', blurb: 'What a shopper sees, holds in a cart, pays and is charged.', docs: (id) => `storefront/contexts/${id}` },
};
const PROG_ORDER = ['wms', 'wes', 'retail-network', 'storefront'];
const COL_HEADS = [
  ['Who or what starts it', 'actor · system'],
  ['The rule or the facts it needs', 'policy · read model'],
  ['The decision', 'command'],
  ['The rule keeper', 'aggregate'],
  ['What happened', 'domain event'],
  ['Who reacts next', 'system · policy'],
];
const VIA = { policy: 'started by the policy', timer: 'started by the clock', mcp: 'called as an MCP tool', a2a: 'called by an agent', job: 'a background job' };

// ---------------------------------------------------------------- the sticky note
function st(kind, label, text, o = {}) {
  const cls = `st st--${kind}${o.cls ? ` ${o.cls}` : ''}`;
  const shown = o.code ? esc(text).replace(/([a-z0-9])([A-Z])/g, '$1<wbr>$2').replace(/([a-z0-9])(-)(?=[a-z])/g, '$1$2<wbr>') : esc(text);
  const inner = `<b class="st__k">${esc(label)}</b><span class="st__t${o.code ? ' st__t--code' : ''}">${shown}</span>${o.sub ? `<span class="st__sub">${esc(o.sub)}</span>` : ''}${o.ctx ? `<span class="st__ctx">${esc(o.ctx)}</span>` : ''}`;
  return o.href ? `<a class="${cls}" href="${o.href}">${inner}</a>` : `<div class="${cls}">${inner}</div>`;
}

export function esView(data) {
  const C = data.counts;
  return {
    boards: C.contexts, rows: n(C.rows), events: n(C.events), commands: n(C.commands), policies: n(C.policies), reads: n(C.reads),
    hotspots: n(C.hotspots), opportunities: n(C.opportunities), phases: C.phases, bigEvents: n(C.bigEvents),
  };
}

export function renderEventstorming({ data, cfg, updatedLabel }) {
  const D = data;
  const M = D.contexts;
  const CT = new Map(FACTS.contexts.map((c) => [c.id, c]));
  const ids = FACTS.contexts.map((c) => c.id);
  const byProg = Object.fromEntries(PROG_ORDER.map((k) => [k, ids.filter((id) => CT.get(id).domain === k)]));
  const order = PROG_ORDER.flatMap((k) => byProg[k]);
  const pages = [];
  const gh = cfg.githubUrl;
  const boardHref = (id, frag = '') => `/eventstorming/contexts/${id}/${frag}`;
  const firstRow = (ctx, ev) => {
    const i = (M[ctx]?.rows || []).findIndex((r) => (r.events || []).includes(ev) || (r.trigger.kind === 'event' && r.trigger.event === ev));
    return i < 0 ? '' : `#row-${i + 1}`;
  };

  // ------------------------------------------------------------ page shell
  const NAV = [['/eventstorming/', 'EventStorming', 'hub'], ['/eventstorming/#big-picture', 'Big picture', 'bp'], ['/eventstorming/#boards', 'The boards', 'boards'], ['/eventstorming/#how-made', 'How it was made', 'how']];
  const layout = ({ path: p, title, description, current, body }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · IQVO EventStorming</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#0B1D2D">
<meta name="color-scheme" content="light">
${cfg.siteUrl ? `<link rel="canonical" href="${cfg.siteUrl}${p}">\n` : ''}<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/assets/fonts/bricolage-grotesque.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/main.css">
<link rel="stylesheet" href="/assets/css/eng.css">
<link rel="stylesheet" href="/assets/css/es.css">
</head>
<body class="eng es">
<a class="skip" href="#main">Skip to content</a>
<div class="sticky">
<p class="banner" role="note">
  <strong>A study project.</strong>
  <span>Not a product, not production, not affiliated with any company.</span>
</p>
<header class="enav" id="top">
  <div class="wrap enav__in">
    <a class="brand" href="/" aria-label="IQVO Warehouse Systems, landing page">
      <img src="/assets/img/iqvo-logo.png" width="130" height="46" alt="IQVO Warehouse Systems">
    </a>
    <nav class="enav__nav" aria-label="EventStorming">
      <ul class="enav__links">
${NAV.map(([href, label, id]) => `        <li><a href="${href}"${id === current ? ' aria-current="page"' : ''}>${label}</a></li>`).join('\n')}
      </ul>
    </nav>
  </div>
</header>
</div>
<main id="main">
${body}
</main>
<footer class="foot">
  <div class="wrap foot__grid">
    <div class="foot__brand">
      <img src="/assets/img/iqvo-logo.png" width="119" height="42" alt="IQVO Warehouse Systems" loading="lazy">
      <p class="foot__tag">Inventory + Queue + Value + Orchestration. A study of Domain-Driven Design with AI agents.</p>
    </div>
    <div class="foot__disc">
      <h2 class="mono foot__h">Disclaimer</h2>
      <p>This project is a domain-driven design study. It is not associated with, endorsed by or affiliated with any company, and it uses no company&rsquo;s code, data, logos or trademarks. All names, figures and examples are illustrative or synthetic.</p>
    </div>
    <div class="foot__made">
      <h2 class="mono foot__h">How these pages were made</h2>
      <p>The boards were drafted by AI agents from each repository&rsquo;s code and documentation, then proven name by name against <code>origin/develop</code> by <code>scripts/collect-eventstorming.mjs</code> on ${esc(updatedLabel)}. They are not the output of a workshop. Directed by a human; notation by Alberto Brandolini&rsquo;s EventStorming.</p>
    </div>
  </div>
  <div class="wrap foot__base mono">
    <span>MIT licence</span>
    <a href="/">Landing page</a>
    <a href="/engineering/">Engineering study</a>
    <a href="/architecture/">Architecture assessment</a>
    <a href="/briefings/">Executive briefings</a>
    <a href="#top">Back to top ↑</a>
  </div>
</footer>
</body>
</html>
`;
  const page = (p) => pages.push({ file: `${p.path.replace(/^\//, '')}index.html`, html: layout(p) });

  // ------------------------------------------------------------ legend
  const exModel = M['inbound-receiving'];
  if (!exModel) throw new Error('eventstorming: the legend needs the inbound-receiving board');
  const exRow = (cmd) => { const r = exModel.rows.find((x) => x.command && x.command.name === cmd); if (!r) throw new Error(`eventstorming: legend example row ${cmd} missing`); return r; };
  const closeRow = exRow('CloseReceipt');
  const policyRow = exRow('CompleteAsn');
  const EX = {
    event: closeRow.events[0], command: closeRow.command.name, actor: closeRow.trigger.name, aggregate: closeRow.aggregate,
    policy: policyRow.policy, read: exRow('OpenReceipt').reads[0], system: closeRow.then[0].system,
    hot: exModel.hotspots[0].text, opp: exModel.opportunities[0].text,
  };
  const LEGEND = [
    ['event', 'Event', 'orange', 'Something that happened, in the past tense. EventStorming always starts here.', EX.event, true],
    ['command', 'Command', 'blue', 'A decision or an intent. It is what causes an event.', EX.command, true],
    ['actor', 'Actor', 'small yellow', 'The person or role who issues the command.', EX.actor, false],
    ['agg', 'Aggregate', 'big pale yellow', 'The rule keeper: accepts or refuses the command and records the event. The EventStorming glossary now calls it a constraint.', EX.aggregate, true],
    ['policy', 'Policy', 'lilac', 'A reaction: whenever X happens, do Y. It sits between an event and the next command.', EX.policy, false],
    ['read', 'Read model', 'green', 'The information someone needs to decide, or a copy kept up to date from events.', EX.read, false],
    ['system', 'External system', 'wide pink', 'Another bounded context, or a system outside the fleet, that takes part in the flow.', EX.system, true],
    ['hot', 'Hot spot', 'neon pink', 'A real problem, open question or known gap. Here each one comes from a decision record.', EX.hot, false],
    ['opp', 'Opportunity', 'dark green', 'A possible improvement that the documentation already names.', EX.opp, false],
  ];
  const legendFull = () => `<dl class="legend--es" aria-label="The sticky-note colours">${LEGEND.map(([k, name, colour, mean, ex, code]) => `
      <div class="lg"><dt>${st(k, name, ex, { code })}</dt><dd><b>${esc(name)}</b>${esc(mean)}<i>${esc(colour)} sticky</i></dd></div>`).join('')}
    </dl>`;
  const legendMini = () => `<ul class="legend--mini" aria-label="Sticky colours used on this board">${LEGEND.map(([k, name]) => `<li><span class="st st--${k}">${esc(name)}</span></li>`).join('')}</ul>`;

  // ------------------------------------------------------------ one row of a board
  const srcLinks = (ctx, evidence) => evidence.map((e) => `<a href="${gh}/${ctx}/blob/develop/${esc(e)}" rel="noopener">${esc(e.replace(/^(internal\/|docs\/adr\/|docs\/docs\/)/, ''))}</a>`).join(' · ');
  function rowHtml(ctx, r, i, { demo = false } = {}) {
    const aOnly = new Set((M[ctx] && M[ctx].source.analyticsOnly) || []);
    const c = [[], [], [], [], [], []];
    const t = r.trigger;
    const sysSticky = (name, outside, o = {}) => st('system', outside ? 'System · outside' : 'System', name, { code: !outside, href: !outside && CT.has(name) ? boardHref(name) : null, ...o });
    if (t.kind === 'actor') c[0].push(st('actor', 'Actor', t.name));
    else if (t.kind === 'external') { c[0].push(sysSticky(t.system, t.outside)); c[0].push(st('event', 'Event', t.event, { code: !t.outside, cls: 'st--in' })); }
    else if (t.kind === 'timer') c[0].push(st('policy', 'Time', t.name));
    else c[0].push(st('event', 'Event · earlier', t.event, { code: true, cls: 'st--in' }));
    if (r.policy) c[1].push(st('policy', 'Policy', r.policy));
    for (const x of r.reads || []) c[1].push(st('read', 'Read model', x));
    if (r.command) c[2].push(st('command', 'Command', r.command.name, { code: true, sub: r.command.route || VIA[r.command.via] || '' }));
    if (r.aggregate) c[3].push(st('agg', 'Aggregate', r.aggregate, { code: true }));
    for (const e of r.events || []) c[4].push(st('event', 'Event', e, { code: true, sub: aOnly.has(e) ? 'analytics stream only' : '' }));
    for (const u of r.updates || []) c[4].push(st('read', 'Read model · kept up to date', u));
    for (const th of r.then || []) c[5].push(`<div class="pair">${sysSticky(th.system, th.outside)}${st('policy', 'Policy', cap(th.does), { cls: 'st--sm' })}</div>`);
    const filled = c.map((x) => x.length > 0);
    const cells = c.map((items, k) => {
      const go = items.length && filled.slice(k + 1).some(Boolean);
      return `<div class="bcell${go ? ' bcell--go' : ''}">${items.join('')}</div>`;
    }).join('');
    const h = demo ? 'h4' : 'h3';
    return `<li class="brow${demo ? ' brow--demo' : ''}"${demo ? '' : ` id="row-${i + 1}"`}>
  <header class="brow__head${demo ? ' brow__head--demo' : ''}">${demo ? '' : `<span class="brow__n" aria-hidden="true">${i + 1}</span>`}<${h}>${esc(r.title)}</${h}><p>${esc(r.story)}</p></header>
  <div class="bgrid">${cells}</div>
  ${demo ? '' : `<p class="brow__src">Source: ${srcLinks(ctx, r.evidence)}</p>`}
</li>`;
  }
  const colHead = () => `<div class="bhead" aria-hidden="true">${COL_HEADS.map(([a, b]) => `<span>${esc(a)}<small>${esc(b)}</small></span>`).join('')}</div>`;

  // ------------------------------------------------------------ the home-page demo row (exported)
  const demoRowHtml = () => `<ol class="board">${rowHtml('inbound-receiving', closeRow, exModel.rows.indexOf(closeRow), { demo: true })}</ol>`;

  // ------------------------------------------------------------ the big picture
  function bigPicture() {
    const E = D.ecosystem;
    const phases = E.phases;
    const ribbon = `<ol class="bp__ribbon" aria-label="The phases, left to right">${phases.map((ph, i) => `<li><a href="#ph-${esc(ph.id)}"><b>${i + 1}</b>${esc(ph.title)}</a></li>`).join('')}</ol>`;
    const evSticky = (ev, pivot) => st('event', pivot ? 'Pivotal event' : 'Event', ev.name, { code: true, cls: `st--sm${pivot ? ' st--pivot' : ''}`, href: boardHref(ev.ctx, firstRow(ev.ctx, ev.name)), ctx: ev.ctx });
    const cols = phases.map((ph, i) => {
      const hot = (ph.hotspots || []).map((h) => st('hot', 'Hot spot', M[h.ctx].hotspots[h.index].text, { cls: 'st--sm', href: boardHref(h.ctx, '#hotspots'), ctx: h.ctx }));
      const opp = (ph.opportunities || []).map((o) => st('opp', 'Opportunity', M[o.ctx].opportunities[o.index].text, { cls: 'st--sm', href: boardHref(o.ctx, '#hotspots'), ctx: o.ctx }));
      return `<li class="bph" id="ph-${esc(ph.id)}">
        <span class="bph__n">Phase ${i + 1}</span>
        <h3>${esc(ph.title)}</h3>
        <p class="bph__plain">${esc(ph.plain)}</p>
        <p class="bph__h">People</p>
        <ul class="bph__lane bph__lane--row">${(ph.actors || []).map((a) => `<li>${st('actor', 'Person', a.name, { cls: 'st--sm' })}</li>`).join('')}</ul>
        <p class="bph__h">What happens, in time order</p>
        <ol class="bph__lane">${[...(ph.events || []).map((ev) => evSticky(ev, false)), evSticky(ph.pivotal, true)].map((x) => `<li>${x}</li>`).join('')}</ol>
        <p class="bph__h">Systems: the bounded contexts here</p>
        <ul class="bph__lane bph__lane--row">${[...ph.contexts.map((id) => st('system', 'System', id, { code: true, cls: 'st--sm', href: boardHref(id) })), ...(ph.systems || []).map((s) => st('system', 'System · outside', s.name, { cls: 'st--sm' }))].map((x) => `<li>${x}</li>`).join('')}</ul>
        ${hot.length ? `<p class="bph__h">Hot spots</p><ul class="bph__lane">${hot.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}
        ${opp.length ? `<p class="bph__h">Opportunities</p><ul class="bph__lane">${opp.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}
      </li>`;
    }).join('');
    return `${ribbon}
    <p class="bp__hint">Phases run left to right; inside a phase the events run top to bottom. Scroll the wall sideways, or jump to a phase above.</p>
    <div class="bp" role="region" aria-label="Big picture EventStorming wall of the whole ecosystem" tabindex="0"><ol class="bp__track">${cols}</ol></div>`;
  }

  // ------------------------------------------------------------ the hub
  {
    const C = D.counts;
    const cards = PROG_ORDER.map((k) => `
    <div class="progh"><h3 id="prog-${k}">${esc(PROGRAMS[k].label)}</h3><p>${esc(plural(byProg[k].length, 'board'))} · ${esc(PROGRAMS[k].blurb)}</p></div>
    <ul class="ctxgrid" aria-labelledby="prog-${k}">${byProg[k].map((id) => {
      const m = M[id]; const k2 = m.counts;
      return `<li><a class="ctxcard" href="${boardHref(id)}"><b>${esc(id)}<i>${esc(CT.get(id).classification)}</i></b><span>${esc(m.oneLine)}</span><small>${n(k2.events || k2.rows)} ${k2.events ? 'events' : 'rows'} · ${n(k2.commands)} commands · ${n(k2.hotspots)} hot spots</small></a></li>`;
    }).join('')}</ul>`).join('');
    const body = `
<section class="esec esec--white" aria-labelledby="hub-title">
  <div class="wrap">
    <p class="kicker">EventStorming · counted ${esc(updatedLabel)}</p>
    <h1 id="hub-title" class="sec-title">The whole ecosystem, <em>on one wall of sticky notes.</em></h1>
    <p class="sec-lede">EventStorming is a workshop method for seeing how a business really works: put what happens on sticky notes along a timeline, then ask what causes each thing. Here it is applied to all ${n(C.contexts)} bounded contexts. First <a href="#big-picture">one big picture</a> of the whole ecosystem, then <a href="#boards">a board for every context</a>, each rebuilt from that context&rsquo;s real code and documentation.</p>
    <dl class="engband engband--light" aria-label="EventStorming in numbers">
      <div><dt>context boards</dt><dd>${n(C.contexts)}</dd></div>
      <div><dt>domain events placed</dt><dd>${n(C.events)}</dd></div>
      <div><dt>commands</dt><dd>${n(C.commands)}</dd></div>
      <div><dt>policies</dt><dd>${n(C.policies)}</dd></div>
      <div><dt>hot spots</dt><dd>${n(C.hotspots)}</dd></div>
    </dl>
  </div>
</section>

<section class="esec" id="what" aria-labelledby="what-title">
  <div class="wrap">
    <h2 id="what-title">What EventStorming <em>is</em></h2>
    <p class="sec-lede">Alberto Brandolini created it in 2013 for Domain-Driven Design. People who know the questions and people who know the answers stand in front of a long paper roll and cover it with sticky notes. The first note is always the same: an <strong>orange domain event</strong>, something that happened, in the past tense, placed on a timeline from left to right. Then the group asks what caused each event, and the colours do the rest. Where events cluster and the vocabulary changes, a bounded context shows itself.</p>
    <ol class="lvl" aria-label="The three levels of EventStorming">
      <li><b>Big Picture</b>Explore a whole business, many people, one very long wall. Events, people, systems, hot spots, opportunities.<em>Here: the wall below</em></li>
      <li class="is-here"><b>Process Modelling</b>One process, step by step. Adds commands, policies and read models.<em>Here: every row of every board</em></li>
      <li class="is-here"><b>Software Design</b>One bounded context. Adds the aggregates that keep the rules.<em>Here: the big yellow notes</em></li>
    </ol>
    <h3>The colours</h3>
    ${legendFull()}
    <p class="mnote"><strong>Colour is never the only clue.</strong> Every note also says what it is in words. Sizes follow the notation too: actors are small, aggregates and policies are big, systems are wide, and a hot spot is slightly tilted so it stands out.</p>
  </div>
</section>

<section class="esec esec--white" id="big-picture" aria-labelledby="bp-title">
  <div class="wrap">
    <h2 id="bp-title">The big picture: <em>one order, end to end</em></h2>
    <p class="sec-lede">${esc(D.ecosystem.lede)} ${plural(D.ecosystem.phases.length, 'phase')}, each closed by a pivotal event, touch all ${n(C.contexts)} bounded contexts. Orange notes are real domain events, each one published by the context named under it; click one to open that context&rsquo;s board at the row where it happens. A thick outline marks the <strong>pivotal event</strong> that ends a phase. Hot spots and opportunities come from the contexts&rsquo; own decision records.</p>
    ${bigPicture()}
  </div>
</section>

<section class="esec" id="how-to-read" aria-labelledby="read-title">
  <div class="wrap">
    <h2 id="read-title">How to read <em>one row</em> of a board</h2>
    <p class="sec-lede">Every board is a stack of small stories. Each row reads left to right, like the paper roll: who or what starts it, the rule or facts it needs, the decision, the rule keeper, what happened, and who reacts next. This is a real row from <a href="${boardHref('inbound-receiving', '#row-' + (exModel.rows.indexOf(closeRow) + 1))}">inbound-receiving</a>.</p>
    ${colHead()}
    ${demoRowHtml()}
    <ol class="how">
      <li><strong>Dock staff</strong> (yellow actor) decide to close the receipt: that is the blue <strong>command</strong> <code>CloseReceipt</code>, reached by <code>POST /receipts/{receiptId}/closures</code>.</li>
      <li>The <strong>aggregate</strong> <code>Receipt</code> (big yellow) checks its rules. If they hold, it records what happened.</li>
      <li>What happened is an orange <strong>event</strong>: <code>ReceiptClosed</code> and the others. Events are facts; they are never undone.</li>
      <li>Other contexts react: a pink <strong>system</strong> with its lilac <strong>policy</strong> (&ldquo;whenever this happens, do that&rdquo;). Nothing calls anything: the reaction is triggered by the event.</li>
    </ol>
  </div>
</section>

<section class="esec esec--white" id="boards" aria-labelledby="boards-title">
  <div class="wrap">
    <h2 id="boards-title">The boards, <em>one per bounded context</em></h2>
    <p class="sec-lede">${n(C.contexts)} boards in four programs. Each opens with the story in a few pivotal events, then walks every row, and ends with hot spots and opportunities taken from the context&rsquo;s own decision records.</p>
    ${cards}
  </div>
</section>

<section class="esec" id="how-made" aria-labelledby="made-title">
  <div class="wrap">
    <h2 id="made-title">How these boards <em>were made</em></h2>
    <p class="mnote"><strong>A reconstruction, not a workshop.</strong> A real EventStorming puts domain experts in a room. These boards were rebuilt from what the repositories say, so they show what the code does today, not what anyone wishes it did.</p>
    <ul class="how">
      <li><strong>Events</strong> come from each context&rsquo;s AsyncAPI contract. A board that leaves a published event out fails the build.</li>
      <li><strong>Commands</strong> come from its OpenAPI contract; a command with no REST route says how it is started instead (a policy, the clock, an agent).</li>
      <li><strong>Aggregates</strong> are types under <code>internal/domain</code>. <strong>Policies and read models</strong> come from the Kafka consumers and the use cases.</li>
      <li><strong>Who reacts next</strong> is only drawn where a real event route exists between the two contexts in the registry.</li>
      <li><strong>Hot spots and opportunities</strong> cite a decision record or a document that states the gap or the plan. None is invented.</li>
      <li><strong>Actors</strong> are the roles the documentation names; where it names none, the plainest role the route implies.</li>
      <li>Every row links to the source files it was read from. <code>scripts/collect-eventstorming.mjs</code> checks every name against <code>origin/develop</code> of each repository.</li>
    </ul>
    <h3>Sources for the method</h3>
    <ul class="srcs">
      <li>Alberto Brandolini, <i>Introducing EventStorming</i> (Leanpub), and his first article, &ldquo;Introducing Event Storming&rdquo; (18 November 2013).</li>
      <li>ddd-crew, <a href="https://github.com/ddd-crew/eventstorming-glossary-cheat-sheet" rel="noopener">EventStorming Glossary &amp; Cheat sheet</a> (CC BY 4.0): the official colours, the three levels and the pivotal-event and hot-spot vocabulary used here.</li>
    </ul>
  </div>
</section>`;
    page({ path: '/eventstorming/', title: 'EventStorming of the whole ecosystem', current: 'hub', description: `A study project, not a product. EventStorming applied to the IQVO study fleet: one big picture of the ecosystem and a board for each of its ${C.contexts} bounded contexts, in the official sticky colours.`, body });
  }

  // ------------------------------------------------------------ one board per context
  order.forEach((id, idx) => {
    const m = M[id]; const f = CT.get(id); const k = m.counts;
    const prog = PROGRAMS[f.domain];
    const prev = order[idx - 1]; const next = order[idx + 1];
    const routesIn = FACTS.edges.filter((e) => e.to === id).map((e) => e.from);
    const routesOut = FACTS.edges.filter((e) => e.from === id).map((e) => e.to);
    const near = (list) => (list.length ? `<div class="ctxnear">${list.map((x) => `<a href="${boardHref(x)}">${esc(x)}</a>`).join('')}</div>` : '<p class="muted">none</p>');
    const pivotal = m.pivotal.map((e) => `<li>${st('event', 'Pivotal event', e, { code: true, href: firstRow(id, e) ? firstRow(id, e) : null })}</li>`).join('');
    const hot = (m.hotspots || []).map((h) => `<li>${st('hot', 'Hot spot', h.text)}<p class="hots__src">Source: <a href="${gh}/${id}/blob/develop/${esc(h.evidence)}" rel="noopener">${esc(h.evidence.replace(/^docs\//, ''))}</a></p></li>`).join('');
    const opp = (m.opportunities || []).map((h) => `<li>${st('opp', 'Opportunity', h.text)}<p class="hots__src">Source: <a href="${gh}/${id}/blob/develop/${esc(h.evidence)}" rel="noopener">${esc(h.evidence.replace(/^docs\//, ''))}</a></p></li>`).join('');
    const docsUrl = `${cfg.docsUrl}/${prog.docs(id)}`;
    const body = `
<section class="ehero ehero--sm"><div class="wrap">
  <nav class="crumbs mono" aria-label="Breadcrumb"><ol><li><a href="/eventstorming/">EventStorming</a></li><li><a href="/eventstorming/#boards">The boards</a></li><li><span aria-current="page">${esc(id)}</span></li></ol></nav>
  <p class="kicker">${esc(prog.label)} · ${esc(f.classification)} domain · EventStorming board</p>
  <h1>${esc(id)}</h1>
  <p class="lede">${esc(m.oneLine)}</p>
  <p class="meta mono"><a href="${gh}/${id}" rel="noopener">GitHub ↗</a> · <a href="${docsUrl}" rel="noopener">Documentation ↗</a> · <a href="/architecture/projects/${id}/">Architecture check</a> · <a href="/briefings/">Briefings</a></p>
  <dl class="engband engband--light" aria-label="This board in numbers">
    <div><dt>${k.published ? 'events published' : 'events published (none)'}</dt><dd>${n(k.published)}</dd></div>
    <div><dt>commands</dt><dd>${n(k.commands)}</dd></div>
    <div><dt>policies</dt><dd>${n(k.policies)}</dd></div>
    <div><dt>read models</dt><dd>${n(k.reads)}</dd></div>
    <div><dt>hot spots</dt><dd>${n(k.hotspots)}</dd></div>
  </dl>
</div></section>

<section class="esec esec--white" aria-labelledby="story-title">
  <div class="wrap">
    <h2 id="story-title">The story in <em>${m.pivotal.length} key ${k.published ? 'events' : 'moments'}</em></h2>
    <p class="sec-lede">${k.published ? 'The pivotal events: the few that matter most, in the order they happen.' : 'This context publishes no events. The pivotal moments are the events it listens to.'}</p>
    <ol class="pivot">${pivotal}</ol>
    <p class="nearh">Listens to (${n(routesIn.length)}): contexts whose events this one reacts to</p>${near(routesIn)}
    <p class="nearh">Tells (${n(routesOut.length)}): contexts that react to its events</p>${near(routesOut)}
  </div>
</section>

<section class="esec" id="board" aria-labelledby="board-title">
  <div class="wrap">
    <h2 id="board-title">The board, <em>row by row</em></h2>
    <p class="sec-lede">${plural(m.rows.length, 'row')}, in the order the business story happens: the main path first, then how this context reacts to the others, then the clock. Rows are small stories; read each one left to right.</p>
    ${legendMini()}
    ${colHead()}
    <ol class="board">${m.rows.map((r, i) => rowHtml(id, r, i)).join('\n')}</ol>
  </div>
</section>

<section class="esec esec--white" id="hotspots" aria-labelledby="hot-title">
  <div class="wrap">
    <h2 id="hot-title">Hot spots and <em>opportunities</em></h2>
    <p class="sec-lede">${hot ? 'Open questions and known gaps, each taken from a decision record or a document in the repository, never invented.' : 'No gap is documented for this context.'}${opp ? ' Opportunities are improvements the documentation already names.' : ''}</p>
    ${hot ? `<ul class="hots">${hot}</ul>` : ''}
    ${opp ? `<h3>Opportunities</h3><ul class="hots">${opp}</ul>` : ''}
    <p class="mnote">This board is a reconstruction from the code and documentation of ${esc(id)} at <code>${esc(m.source.ref)}</code>, not a workshop output. Roles are the ones the documentation names. <a href="/eventstorming/#how-made">How the boards were made</a>.</p>
    <nav class="pager mono" aria-label="Other boards">${prev ? `<a href="${boardHref(prev)}" rel="prev">← ${esc(prev)}</a>` : '<span></span>'}${next ? `<a href="${boardHref(next)}" rel="next">${esc(next)} →</a>` : '<span></span>'}</nav>
  </div>
</section>`;
    page({ path: `/eventstorming/contexts/${id}/`, title: `${id} · board`, current: 'boards', description: `A study project, not a product. The EventStorming board of the ${id} bounded context: ${m.oneLine}`, body });
  });

  pages.demoRow = demoRowHtml;
  pages.legend = legendFull;
  return pages;
}

export function esDemoRow(data, cfg) {
  const pages = renderEventstorming({ data, cfg, updatedLabel: '' });
  return { demo: pages.demoRow(), legend: pages.legend() };
}

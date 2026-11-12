// Renders the executive briefings (data/briefings.json) into landing-template pages under dist/briefings/.
//   /briefings/                 the hub: four programs + the platform strip
//   /briefings/<program>/       one landing page per program: WMS/WES, retail, YMS, storefront
// Sections reuse the landing page's own classes (section, sec-head, kicker, engband, cta, caveat);
// the only new CSS is for the flow diagram, the hexagon and the deck chips (eng.css).
// No JavaScript; every figure is counted. Prose quotes the committed decks, credited as such.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ENG = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'data', 'engineering.json'), 'utf8'));
const ARCH = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'data', 'architecture.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('en-US');
const n = (x) => (x == null ? '—' : nf.format(x));
const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);
const median = (arr) => { const s = arr.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const dLong = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const clip = (s, k) => (String(s ?? '').length > k ? `${String(s ?? '').slice(0, k).trimEnd()}…` : String(s ?? ''));

// ---------------------------------------------------------------- program copy (hand-written, figures counted)
const PROG = {
  'wms-wes': {
    title: 'The warehouse, from dock door <em>to dispatch.</em>',
    card: 'The warehouse, dock to dispatch',
    lede: 'Eighteen bounded contexts run the building: master data, receiving, storage and slotting, order waves, execution, labour and the exception desk. Each one owns its language, its data and its events — nothing calls a sibling, everything integrates through Kafka.',
    stages: [
      ['Master data', ['product-master', 'facility-layout']],
      ['Receive', ['inbound-receiving', 'dock-scheduling']],
      ['Store', ['inventory-storage', 'slotting-optimization', 'pick-face-replenishment']],
      ['Fulfil', ['order-management', 'fulfillment-execution', 'task-interleaving']],
      ['Work the floor', ['warehouse-planning', 'wes-work-planning', 'process-path-management', 'labor-performance', 'workforce-management']],
      ['Ship & exceptions', ['outbound-shipping', 'returns-processing', 'exception-management']],
    ],
    bridgeNote: 'Two bridge contexts sit in this program because the registry classifies them WES: network-fulfillment and network-inventory-planning connect the building to the retail network.',
    bridge: ['network-fulfillment', 'network-inventory-planning'],
  },
  retail: {
    title: 'From network node <em>to doorstep.</em>',
    card: 'The retail network',
    lede: 'The second domain: a retail fulfilment network of nodes, offers, promises and parcels. Ten contexts decide where stock lives, what can be promised to a customer, which node serves an order and how the parcel travels — the warehouse fleet is their execution arm.',
    stages: [
      ['Topology', ['node-topology', 'node-performance']],
      ['Supply', ['seller-inbound', 'vendor-connectivity']],
      ['Offer', ['offer-availability']],
      ['Promise', ['delivery-promise']],
      ['Order', ['customer-ordering', 'order-sourcing']],
      ['Deliver', ['linehaul-transportation', 'last-mile-delivery', 'shipping-and-tracking']],
    ],
  },
  yms: {
    title: 'Between the gate and <em>the dock door.</em>',
    card: 'The yard program',
    lede: 'The yard program: everything that happens to a trailer after it reaches the fence and before the dock door takes over. Appointments, gates, yard moves, the exceptions that surface when a load goes missing — and the linehaul leg that carries it away. Young, honest, and growing in public.',
    stages: [
      ['Schedule', ['dock-scheduling']],
      ['Gate & yard', ['yard-management']],
      ['Exceptions', ['exception-management']],
      ['Linehaul', ['linehaul-transportation']],
    ],
  },
  storefront: {
    title: 'From first search <em>to paid order.</em>',
    card: 'The storefront',
    lede: 'The digital storefront: six contexts that face the customer. Content and discovery, pricing, the cart, checkout and payments — each a small bounded context behind a storefront BFF, integrating with the retail network\'s promises and the warehouse\'s execution.',
    stages: [
      ['Discover', ['product-discovery', 'product-content']],
      ['Price', ['pricing']],
      ['Cart', ['shopping-cart']],
      ['Checkout', ['checkout']],
      ['Pay', ['customer-payments']],
    ],
  },
};

export function renderBriefings({ data, cfg, updatedLabel }) {
  const D = data;
  const ctxOf = (id) => D.members && Object.entries(PROG).find(([k]) => (D.members[k] || []).includes(id));
  const engOf = (id) => ENG.repos[id];
  const archOf = (id) => ARCH.repos[id];
  const deckOf = (id) => D.decks[id] || null;
  const deg = { in: {}, out: {} };
  for (const e of D.edges) { deg.out[e.from] = (deg.out[e.from] || 0) + 1; deg.in[e.to] = (deg.in[e.to] || 0) + 1; }
  const pages = [];
  const PROG_ORDER = ['wms-wes', 'retail', 'yms', 'storefront'];

  const NAV = [['/briefings/', 'Briefings', 'hub'], ...PROG_ORDER.map((k) => [`/briefings/${k}/`, PROG[k] ? { 'wms-wes': 'WMS / WES', retail: 'Retail', yms: 'Yard', storefront: 'Storefront' }[k] : k, k])];
  const layout = ({ path, title, description, current, body }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · IQVO executive briefings</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#0B1D2D">
<meta name="color-scheme" content="light">
${cfg.siteUrl ? `<link rel="canonical" href="${cfg.siteUrl}${path}">\n` : ''}<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/assets/fonts/bricolage-grotesque.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/main.css">
<link rel="stylesheet" href="/assets/css/eng.css">
</head>
<body class="eng brief">
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
    <nav class="enav__nav" aria-label="Executive briefings">
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
      <p>The briefings themselves are reveal.js decks committed in each repository; their mission, capabilities, events and next steps are quoted from those decks by <code>scripts/collect-briefings.mjs</code> on ${esc(updatedLabel)}, joined with the day&rsquo;s counted engineering and architecture data. Diagrams are drawn from the context registry&rsquo;s event routes. Written by GLM 5.3 (Z.ai) under human direction.</p>
    </div>
  </div>
  <div class="wrap foot__base mono">
    <span>MIT licence</span>
    <a href="/">Landing page</a>
    <a href="/engineering/">Engineering study</a>
    <a href="/architecture/">Architecture assessment</a>
    <a href="#top">Back to top ↑</a>
  </div>
</footer>
</body>
</html>
`;
  const page = (p) => pages.push({ file: `${p.path.replace(/^\//, '')}index.html`, html: layout(p) });

  // ---------------------------------------------------------------- diagram 1: the program flow
  // Stages left -> right; contexts as nodes; arrows are the registry's real event routes.
  function flowDiagram(progKey) {
    const stages = PROG[progKey].stages;
    const members = new Set(D.members[progKey]);
    const NW = 1080; const COL = stages.length;
    const colW = NW / COL;
    const nodeW = 148; const nodeH = 46; const gapY = 12;
    const nodes = []; const pos = new Map();
    stages.forEach(([label, ids], ci) => {
      const list = ids.filter((id) => members.has(id));
      list.forEach((id, ri) => { pos.set(id, { x: 0, y: 0, ci, ri }); nodes.push(id); });
    });
    // barycentre ordering: within each column, sort nodes by where their routes come from / go to
    const nbOut = new Map(nodes.map((id) => [id, D.edges.filter((e) => e.from === id && members.has(e.to)).map((e) => pos.get(e.to))]));
    const nbIn = new Map(nodes.map((id) => [id, D.edges.filter((e) => e.to === id && members.has(e.from)).map((e) => pos.get(e.from))]));
    const bary = (id) => {
      const os = (nbOut.get(id) || []).filter(Boolean); const is = (nbIn.get(id) || []).filter(Boolean);
      const vals = [...os.map((p) => p.ci * 10 + p.ri), ...is.map((p) => p.ci * 10 + p.ri)];
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : pos.get(id).ri;
    };
    stages.forEach(([, ids]) => {
      const list = ids.filter((id) => members.has(id)).sort((a, b) => bary(a) - bary(b));
      list.forEach((id, ri) => { pos.get(id).ri = ri; });
    });
    const rows = Math.max(...stages.map(([, ids]) => ids.filter((id) => members.has(id)).length));
    const H = 46 + rows * (nodeH + gapY) + 14;
    stages.forEach(([label, ids], ci) => {
      const list = ids.filter((id) => members.has(id));
      const x = ci * colW + (colW - nodeW) / 2;
      const top = 46 + (rows - list.length) * (nodeH + gapY) / 2;
      list.forEach((id, ri) => { const p = pos.get(id); p.x = x; p.y = top + ri * (nodeH + gapY); });
    });
    const id2 = (id) => id.length > 23 ? `${id.slice(0, 22)}…` : id;
    let out = `<rect class="fd__bg" x="0" y="0" width="${NW}" height="${H}" rx="10"/>`;
    out += `<defs><marker id="ah-${progKey}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0.6 L7.4,4 L0,7.4 Z" class="fd__ah"/></marker></defs>`;
    stages.forEach(([label], ci) => {
      out += `<text class="fd__stage" x="${(ci * colW + colW / 2).toFixed(1)}" y="26" text-anchor="middle">${esc(label)}</text>`;
      if (ci) out += `<line class="fd__col" x1="${(ci * colW).toFixed(1)}" x2="${(ci * colW).toFixed(1)}" y1="14" y2="${H - 10}"/>`;
    });
    // edges: internal = solid curve, crossing = dashed stub at the node's edge
    const seen = new Set();
    const edgePath = (a, b) => {
      const A = pos.get(a); const B = pos.get(b);
      if (!A || !B) return null;
      const ax = A.x + nodeW; const ay = A.y + nodeH / 2;
      const bx = B.x; const by = B.y + nodeH / 2;
      if (A.ci === B.ci) { // same stage: short connector on the side of the column
        const mx = A.x + nodeW + 10;
        return `M ${A.x + nodeW - 4} ${A.ri < B.ri ? A.y + nodeH : A.y} C ${mx} ${ay}, ${mx} ${by}, ${B.x + nodeW - 4} ${A.ri < B.ri ? B.y : B.y + nodeH}`;
      }
      const mx = (ax + bx) / 2;
      return `M ${ax - 3} ${ay} C ${mx} ${ay}, ${mx} ${by}, ${bx - 2} ${by}`;
    };
    for (const e of D.edges) {
      const aIn = members.has(e.from); const bIn = members.has(e.to);
      if (aIn && bIn) {
        const key = `${e.from}>${e.to}`;
        if (seen.has(key)) continue; seen.add(key);
        const p = edgePath(e.from, e.to);
        if (p) out += `<path class="fd__edge" d="${p}" marker-end="url(#ah-${progKey})"><title>${esc(e.from)} → ${esc(e.to)}</title></path>`;
      }
    }
    for (const id of nodes) {
      const p = pos.get(id);
      const degOut = deg.out[id] || 0; const degIn = deg.in[id] || 0;
      out += `<g class="fd__node"><rect x="${p.x}" y="${p.y}" width="${nodeW}" height="${nodeH}" rx="8"/><text x="${(p.x + nodeW / 2).toFixed(1)}" y="${(p.y + 18).toFixed(1)}" text-anchor="middle" class="fd__name${id.length > 19 ? ' fd__name--sm' : ''}">${esc(id2(id))}</text><text x="${(p.x + nodeW / 2).toFixed(1)}" y="${(p.y + 34).toFixed(1)}" text-anchor="middle" class="fd__deg">▲${degIn} ▼${degOut}</text><title>${esc(id)}: consumes ${degIn} route(s), publishes to ${degOut}</title></g>`;
    }
    // crossing routes: named stubs under the diagram body
    const crossing = [];
    for (const e of D.edges) {
      if (members.has(e.from) && !members.has(e.to)) crossing.push(`${e.from} → ${e.to}`);
      else if (!members.has(e.from) && members.has(e.to)) crossing.push(`${e.to} ← ${e.from}`);
    }
    const uniq = [...new Set(crossing)];
    return {
      svg: `<svg class="fd" viewBox="0 0 ${NW} ${H}" role="img" aria-label="Event flow of the ${esc(D.programs[progKey].label)} program: ${esc(nodes.join(', '))}">${out}</svg>`,
      internal: seen.size, crossing: uniq.length, crossingList: uniq.slice(0, 12),
    };
  }

  // ---------------------------------------------------------------- diagram 2: the hexagon (counted adapters)
  function hexagon(id) {
    const a = archOf(id)?.ff?.adapters?.detail;
    if (!a || (!a.inbound.length && !a.outbound.length)) return null;
    const W = 340; const H = 40 + Math.max(a.inbound.length, a.outbound.length, 1) * 26 + 8;
    const chip = (list, x, cls) => list.map((name, i) => `<g class="hx__chip hx__chip--${cls}"><rect x="${x}" y="${44 + i * 26}" width="118" height="21" rx="10.5"/><text x="${x + 59}" y="${58 + i * 26}" text-anchor="middle">${esc(name)}</text></g>`).join('');
    return `<svg class="hx" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(id)} hexagon: ${a.inbound.length} inbound and ${a.outbound.length} outbound adapters around the domain">
<rect class="hx__bg" x="0" y="0" width="${W}" height="${H}" rx="10"/>
<text class="hx__side" x="59" y="32" text-anchor="middle">driving (in)</text><text class="hx__side" x="${W - 59}" y="32" text-anchor="middle">driven (out)</text>
${chip(a.inbound, 10, 'in')}${chip(a.outbound.reverse(), W - 128, 'out')}
<g class="hx__core"><rect x="${W / 2 - 46}" y="${H / 2 - 26}" width="92" height="52" rx="10"/><text x="${W / 2}" y="${H / 2 - 4}" text-anchor="middle" class="hx__coreT">domain +</text><text x="${W / 2}" y="${H / 2 + 14}" text-anchor="middle" class="hx__coreT">use cases</text><title>the domain depends on nothing outward (architecture assessment: domain purity)</title></g>
<line class="hx__link" x1="128" y1="${H / 2}" x2="${W / 2 - 46}" y2="${H / 2}"/><line class="hx__link" x1="${W / 2 + 46}" y1="${H / 2}" x2="${W - 128}" y2="${H / 2}"/>
</svg>`;
  }

  const deckUrl = (id) => {
    const d = deckOf(id); const e = engOf(id);
    if (!d || !e || e.private) return null;
    return `${cfg.githubUrl}/${id}/blob/${d.defaultBranch}/executive/index.html`;
  };

  // ---------------------------------------------------------------- counted chips for one context
  const chips = (id) => {
    const e = engOf(id); const a = archOf(id);
    if (!e) return '';
    const items = [
      e.total && [`${n(e.total.commits)} commits`, `${n(e.total.prMerged)} PRs merged`],
      e.total?.releases && [`${n(e.total.releases)} releases`],
      a?.fitness != null && [`architecture ${a.fitness}%`],
      e.score?.total != null && [`engineering ${e.score.total}/100`],
      (deg.out[id] || deg.in[id]) && [`${deg.in[id] || 0} in / ${deg.out[id] || 0} out routes`],
    ].filter(Boolean).map(([t]) => t);
    return `<p class="mono chips">${items.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</p>`;
  };

  // ---------------------------------------------------------------- one briefed project (story block)
  function projectBlock(id, i) {
    const d = deckOf(id); const e = engOf(id); const c = D.programs ? null : null;
    const url = deckUrl(id);
    const hex = hexagon(id);
    const caps = (d?.capabilities || []).slice(0, 3);
    const body = `
<article class="proj${i % 2 ? ' proj--flip' : ''}" id="p-${esc(id)}">
  <div class="proj__main">
    <p class="kicker mono">${esc(id)}${e?.classification ? ` · ${esc(e.classification.toLowerCase())}` : ''}</p>
    <h3>${d?.tagline ? esc(clip(d.tagline, 110)) : esc(id)}</h3>
    ${d?.mission ? `<p class="proj__mission">${esc(clip(d.mission, 340))}</p>` : ''}
    ${caps.length ? `<ul class="ticks ticks--plain proj__caps">${caps.map((c2) => `<li>${esc(clip(c2, 190))}</li>`).join('')}</ul>` : ''}
    ${(d?.eventsProduced?.length || d?.eventsConsumed?.length) ? `<div class="ev"><p class="mono ev__h">publishes</p><ul class="ev__l">${(d.eventsProduced || []).slice(0, 6).map((t) => `<li class="ev__e">${esc(t)}</li>`).join('')}</ul>${d.eventsConsumed?.length ? `<p class="mono ev__h">consumes</p><ul class="ev__l ev__l--c">${d.eventsConsumed.slice(0, 4).map((t) => `<li class="ev__e">${esc(t)}</li>`).join('')}</ul>` : ''}</div>` : ''}
    ${d?.risks?.length ? `<p class="caveat caveat--sm"><strong>Named risks.</strong> ${esc(clip(d.risks[0], 200))}</p>` : ''}
    ${d?.nextSteps?.length ? `<p class="proj__next"><b>Next:</b> ${esc(clip(d.nextSteps[0], 170))}</p>` : ''}
  </div>
  <aside class="proj__side">
    ${hex || ''}
    ${chips(id)}
    <p class="proj__links mono">
      ${url ? `<a href="${url}" rel="noopener">Briefing deck ↗</a>` : '<span class="muted">deck in a private repository</span>'}
      <a href="/engineering/projects/${esc(id)}/">Engineering study</a>
      <a href="/architecture/projects/${esc(id)}/">Architecture check</a>
    </p>
  </aside>
</article>`;
    return body;
  }

  // ---------------------------------------------------------------- program pages
  for (const key of PROG_ORDER) {
    const P = PROG[key];
    const members = D.members[key];
    const briefed = members.filter((id) => deckOf(id));
    const pending = members.filter((id) => !deckOf(id));
    const flow = flowDiagram(key);
    const commits = sum(members.map((id) => engOf(id)?.total?.commits || 0));
    const prs = sum(members.map((id) => engOf(id)?.total?.prMerged || 0));
    const scores = members.map((id) => engOf(id)?.score?.total).filter((x) => x != null);
    const adrs = sum(members.map((id) => engOf(id)?.harnessCounts?.adrs || 0));
    const pendRows = pending.map((id) => `<li><b>${esc(id)}</b> ${chips(id)}<a class="mono" href="${cfg.githubUrl}/${id}" rel="noopener">repo ↗</a></li>`).join('');

    const body = `
<section class="section section--white" aria-labelledby="h-${key}">
  <div class="wrap">
    <header class="sec-head">
      <p class="kicker">${esc(D.programs[key].label)} · executive briefings · counted ${esc(updatedLabel)}</p>
      <h2 id="h-${key}" class="visually-hidden">${esc(D.programs[key].label)} executive briefings</h2>
      <h1 class="sec-title">${P.title}</h1>
      <p class="sec-lede">${esc(P.lede)}</p>
    </header>
    <dl class="engband engband--light" aria-label="The program in numbers">
      <div><dt>bounded contexts</dt><dd>${n(members.length)}</dd></div>
      <div><dt>briefing decks</dt><dd>${n(briefed.length)}</dd></div>
      <div><dt>event routes drawn</dt><dd>${n(flow.internal)}<span class="engband__sub">+${n(flow.crossing)} crossing</span></dd></div>
      <div><dt>commits</dt><dd>${n(commits)}</dd></div>
      <div><dt>median eng. score</dt><dd>${scores.length ? n(Math.round(median(scores))) : '—'}</dd></div>
    </dl>
  </div>
</section>

<section class="section section--dark" aria-labelledby="f-${key}">
  <div class="wrap">
    <header class="sec-head">
      <p class="kicker">How the pieces talk</p>
      <h2 id="f-${key}">Every arrow is a <em>real event route.</em></h2>
      <p class="sec-lede">Counted from the context registry, not drawn by hand: solid arrows are Kafka routes inside the program; ▲ is the routes a context consumes and ▼ the routes it publishes. ${flow.crossing ? `${n(flow.crossing)} more routes cross the program boundary.` : 'No route leaves the program.'}</p>
    </header>
    <div class="tw" role="region" aria-label="Event flow diagram" tabindex="0">${flow.svg}</div>
  </div>
</section>

${briefed.length ? `<section class="section section--white" aria-labelledby="b-${key}">
  <div class="wrap">
    <header class="sec-head">
      <p class="kicker">The briefings</p>
      <h2 id="b-${key}">${n(briefed.length)} projects, briefed like <em>a business.</em></h2>
      <p class="sec-lede">Mission, capabilities, events, risks and next steps — quoted from each repository's committed executive deck; every number beside them is counted from git and the GitHub API.</p>
    </header>
    <div class="projs">${briefed.map((id, i) => projectBlock(id, i)).join('')}</div>
  </div>
</section>` : ''}

${pending.length ? `<section class="section ${briefed.length ? '' : 'section--white'}" aria-labelledby="w-${key}">
  <div class="wrap">
    <header class="sec-head">
      <p class="kicker">Not yet briefed</p>
      <h2 id="w-${key}">${n(pending.length)} contexts, <em>counted anyway.</em></h2>
      <p class="sec-lede">No executive deck is committed for these yet — published as a gap, not papered over. Their numbers are the same counted set.</p>
    </header>
    <ul class="pending">${pendRows}</ul>
  </div>
</section>` : ''}

${P.bridgeNote ? `<section class="section section--white"><div class="wrap"><p class="caveat"><strong>Registry note.</strong> ${esc(P.bridgeNote)}</p></div></section>` : ''}`;

    page({ path: `/briefings/${key}/`, title: `${D.programs[key].label} briefings`, current: key, description: `A study project, not a product. Executive briefings for the ${D.programs[key].label} program: ${briefed.length} decks, ${members.length} bounded contexts, event routes counted from the registry.`, body });
  }

  // ---------------------------------------------------------------- hub
  {
    const F = D.fleet;
    const platform = Object.values(D.decks).filter((d) => !Object.values(D.members).some((m) => m.includes(d.repo)));
    const cards = PROG_ORDER.map((k) => {
      const members = D.members[k]; const briefed = members.filter((id) => deckOf(id));
      const commits = sum(members.map((id) => engOf(id)?.total?.commits || 0));
      return `<li class="pcard"><a href="/briefings/${k}/">
        <p class="kicker mono">${esc(D.programs[k].label)}</p>
        <h3>${esc(PROG[k].card)}</h3>
        <p class="pcard__lede">${esc(PROG[k].lede.split('. ')[0])}.</p>
        <p class="mono pcard__n">${n(members.length)} contexts · ${n(briefed.length)} deck${briefed.length === 1 ? '' : 's'} · ${n(commits)} commits</p>
      </a></li>`;
    }).join('');
    const platCards = platform.map((d) => `<li class="platcard"><b>${esc(d.repo)}</b><span class="muted">${esc(clip(d.tagline || '', 80))}</span><a class="mono" href="${cfg.githubUrl}/${d.repo}/blob/${d.defaultBranch}/executive/index.html" rel="noopener">deck ↗</a></li>`).join('');
    const body = `
<section class="section section--white" aria-labelledby="hub-title">
  <div class="wrap">
    <header class="sec-head">
      <p class="kicker">Executive briefings · counted ${esc(updatedLabel)}</p>
      <h2 id="hub-title" class="visually-hidden">Executive briefings hub</h2>
      <h1 class="sec-title">Every project, briefed like <em>a business.</em></h1>
      <p class="sec-lede">Each repository ships a reveal.js executive briefing — mission, capabilities, events, observability, risks, next steps. These pages quote them, join them to the counted engineering and architecture data, and draw each program's real event flow. Four programs, one study.</p>
    </header>
    <dl class="engband engband--light" aria-label="The briefings in numbers">
      <div><dt>briefing decks</dt><dd>${n(F.decks)}</dd></div>
      <div><dt>programs</dt><dd>${n(F.programs)}</dd></div>
      <div><dt>bounded contexts</dt><dd>${n(F.contexts)}</dd></div>
      <div><dt>event routes</dt><dd>${n(F.events)}</dd></div>
      <div><dt>ADRs across programs</dt><dd>${n(sum(Object.values(ENG.repos).map((e) => e.harnessCounts?.adrs || 0)))}</dd></div>
    </dl>
    <ul class="pcards">${cards}</ul>
  </div>
</section>

<section class="section section--dark" aria-labelledby="plat-title">
  <div class="wrap">
    <header class="sec-head">
      <p class="kicker">The platform under the programs</p>
      <h2 id="plat-title">Console, kit, infra, harness — <em>also briefed.</em></h2>
      <p class="sec-lede">${n(platform.length)} platform decks: the surfaces every program shares.</p>
    </header>
    <ul class="platcards">${platCards}</ul>
    <p class="caveat"><strong>Honesty first.</strong> Decks are committed artifacts in each repository, regenerated by a pipeline, never hand-tuned for this page; where a context has no deck yet, the page says so.</p>
  </div>
</section>`;
    page({ path: '/briefings/', title: 'Executive briefings', current: 'hub', description: `A study project, not a product. ${F.decks} executive briefing decks across ${F.programs} programs of the IQVO study fleet, quoted and counted.`, body });
  }

  return pages;
}

export function briefingsView(data) {
  const F = data.fleet;
  return {
    decks: F.decks,
    programs: F.programs,
    contexts: F.contexts,
    events: new Intl.NumberFormat('en-US').format(F.events),
  };
}

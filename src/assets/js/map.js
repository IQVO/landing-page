// Interactive event map. Data (positions, routes) is generated from the real repositories
// by scripts/collect-facts.mjs and inlined by scripts/build.mjs as #map-data.
(() => {
  'use strict';
  const root = document.querySelector('[data-map]');
  const dataEl = document.getElementById('map-data');
  if (!root || !dataEl) return;

  const data = JSON.parse(dataEl.textContent);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stage = root.querySelector('[data-map-stage]');
  const info = root.querySelector('[data-map-info]');
  const legendEl = root.querySelector('[data-map-legend]');
  const modeBtns = [...root.querySelectorAll('[data-mode]')];
  const NS = 'http://www.w3.org/2000/svg';
  const W = 1000, H = 740;

  // Only plain https/http links may reach an href; anything else (javascript:, data:, ...) becomes '#'.
  const safeUrl = (u) => {
    try { const x = new URL(u, location.href); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '#'; } catch { return '#'; }
  };

  const el = (name, attrs = {}, parent) => {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };

  const DOMAINS = {
    wms: { label: 'WMS', color: '#4a9bd8', docs: (id) => `${data.docs}/contexts/${id}` },
    wes: { label: 'WES', color: '#44ccac', docs: (id) => `${data.docs}/contexts/${id}` },
    'retail-network': { label: 'Retail Network', color: '#a8ddf0', docs: (id) => `${data.docs}/network/contexts/${id}` },
    storefront: { label: 'Digital Storefront', color: '#f2b84b', docs: (id) => `${data.docs}/storefront/contexts/${id}` },
  };
  const strat = (n) => (n.k === 'Core' ? 'Core' : n.k.startsWith('Generic') ? 'Generic' : 'Supporting');
  const MODES = {
    domain: { items: Object.entries(DOMAINS).map(([key, v]) => ({ key, label: v.label, color: v.color })), pick: (n) => n.d },
    strategy: {
      items: [
        { key: 'Core', label: 'Core', color: '#44ccac' },
        { key: 'Supporting', label: 'Supporting', color: '#4a9bd8' },
        { key: 'Generic', label: 'Generic', color: '#9fb3c2' },
      ],
      pick: strat,
    },
    agents: {
      items: [
        { key: 'mcp', label: 'MCP server + A2A card', color: '#44ccac' },
        { key: 'a2a', label: 'A2A card only', color: '#f2b84b' },
      ],
      pick: (n) => (n.m ? 'mcp' : 'a2a'),
    },
  };

  /* ---------- state ---------- */
  const nodes = data.nodes;
  // fit the generated layout to the viewBox (keeps aspect ratio)
  {
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const pad = { l: 64, r: 64, t: 92, b: 54 };
    const k = Math.min((W - pad.l - pad.r) / (x1 - x0), (H - pad.t - pad.b) / (y1 - y0));
    const ox = pad.l + (W - pad.l - pad.r - (x1 - x0) * k) / 2, oy = pad.t + (H - pad.t - pad.b - (y1 - y0) * k) / 2;
    nodes.forEach((n) => { n.x = Math.round(ox + (n.x - x0) * k); n.y = Math.round(oy + (n.y - y0) * k); });
  }
  const edges = data.edges;
  const adj = nodes.map(() => new Set());
  const adjEdges = nodes.map(() => []);
  edges.forEach(([a, b], i) => { adj[a].add(b); adj[b].add(a); adjEdges[a].push(i); adjEdges[b].push(i); });
  const order = nodes.map((_, i) => i).sort((a, b) => (nodes[a].d + nodes[a].id).localeCompare(nodes[b].d + nodes[b].id));
  let mode = 'domain', filter = null, sel = null, hover = null, tour = null;

  const radius = (n) => (n.k === 'Core' ? 15 : n.k.startsWith('Generic') ? 8.5 : 11.5);

  /* ---------- build svg ---------- */
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true', focusable: 'false' });
  stage.appendChild(svg);
  const gGlow = el('g', {}, svg), gEdges = el('g', {}, svg), gPulses = el('g', {}, svg), gNodes = el('g', {}, svg);

  // domain glow + label at each cluster's centroid
  for (const [key, d] of Object.entries(DOMAINS)) {
    const mine = nodes.filter((n) => n.d === key);
    if (!mine.length) continue;
    const cx = mine.reduce((s, n) => s + n.x, 0) / mine.length;
    const cy = mine.reduce((s, n) => s + n.y, 0) / mine.length;
    const r = Math.max(...mine.map((n) => Math.hypot(n.x - cx, n.y - cy))) + 52;
    const g = el('circle', { cx, cy, r, fill: d.color, class: 'map-glow', 'data-d': key }, gGlow);
    g.style.filter = 'blur(26px)';
    const top = Math.min(...mine.map((n) => n.y));
    const t = el('text', { x: cx, y: Math.max(28, top - 46), 'text-anchor': 'middle', class: 'map-cluster' }, gGlow);
    t.textContent = d.label;
  }

  // routes: gentle curves so parallel routes do not stack into one line
  const edgeEls = edges.map(([a, b], i) => {
    const A = nodes[a], B = nodes[b];
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
    const bend = ((i * 37) % 7 - 3) * 0.045 * len;
    const cx = mx + (-dy / len) * bend, cy = my + (dx / len) * bend;
    const p = el('path', { d: `M${A.x} ${A.y}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${B.x} ${B.y}`, class: 'map-edge' }, gEdges);
    return { p, A, B, cx, cy };
  });

  const nodeEls = nodes.map((n, i) => {
    const g = el('g', { class: 'map-node', 'data-i': i }, gNodes);
    const r = radius(n);
    g.style.setProperty('--r', r);
    el('circle', { cx: n.x, cy: n.y, r: r + 12, class: 'hit' }, g);
    el('circle', { cx: n.x, cy: n.y, r: r + 5, class: 'ring' }, g);
    el('circle', { cx: n.x, cy: n.y, r, class: 'dot' }, g);
    const t = el('text', { x: n.x, y: n.y - r - 11, 'text-anchor': 'middle', class: 'lbl' }, g);
    t.textContent = n.id;
    g.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hover = i; paint(); } });
    g.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { hover = null; paint(); } });
    g.addEventListener('click', (e) => { e.stopPropagation(); sel = sel === i ? null : i; hover = null; paint(); });
    return g;
  });
  svg.addEventListener('click', () => { if (sel !== null) { sel = null; paint(); } });

  /* ---------- paint ---------- */
  const colorOf = (n) => {
    const key = MODES[mode].pick(n);
    return MODES[mode].items.find((x) => x.key === key).color;
  };

  function renderInfo(i) {
    info.textContent = '';
    if (i === null) {
      const p = document.createElement('p');
      p.className = 'mono mapcard__hint';
      p.textContent = filter ? `Showing ${filterLabel()} only. Click it again to clear.` : 'Hover, tap or arrow-key through a context';
      info.appendChild(p);
      return;
    }
    const n = nodes[i];
    const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
    info.appendChild(mk('p', 'mono hud__meta', `${DOMAINS[n.d].label} · ${n.k}`));
    info.appendChild(mk('p', 'hud__name', n.id));
    info.appendChild(mk('p', 'hud__purpose', n.p));
    const tags = mk('p', 'mono hud__tags');
    [n.m ? 'MCP' : null, n.a ? 'A2A' : null, n.r ? `${n.r} ADRs` : null, `${n.o} out`, `${n.i} in`].filter(Boolean).forEach((t) => tags.appendChild(mk('span', '', t)));
    const doc = mk('a', '', 'docs ↗'); doc.href = safeUrl(DOMAINS[n.d].docs(n.id)); doc.rel = 'noopener';
    const repo = mk('a', '', 'repo ↗'); repo.href = safeUrl(`${data.github}/${encodeURIComponent(n.id)}`); repo.rel = 'noopener';
    tags.append(doc, repo);
    info.appendChild(tags);
  }

  const filterLabel = () => (MODES[mode].items.find((x) => x.key === filter) || {}).label || '';

  function paint() {
    const focus = hover !== null ? hover : sel !== null ? sel : tour;
    const near = focus !== null ? adj[focus] : null;
    nodeEls.forEach((g, i) => {
      const n = nodes[i];
      g.style.setProperty('--c', colorOf(n));
      let dim = false;
      if (focus !== null) dim = i !== focus && !near.has(i);
      else if (filter) dim = MODES[mode].pick(n) !== filter;
      g.classList.toggle('is-dim', dim);
      g.classList.toggle('is-sel', i === focus);
      g.classList.toggle('is-near', !!near && near.has(i));
    });
    edgeEls.forEach((e, i) => {
      const [a, b] = edges[i];
      const on = focus !== null && (a === focus || b === focus);
      let dim = false;
      if (focus !== null) dim = !on;
      else if (filter) dim = MODES[mode].pick(nodes[a]) !== filter && MODES[mode].pick(nodes[b]) !== filter;
      e.p.classList.toggle('is-on', on);
      e.p.classList.toggle('is-dim', dim);
    });
    gGlow.querySelectorAll('.map-glow').forEach((g) => { g.style.opacity = mode === 'domain' ? '' : '0.05'; });
    renderInfo(focus);
    focusIdx = focus;
  }

  function paintLegend() {
    legendEl.textContent = '';
    MODES[mode].items.forEach((it) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(filter === it.key));
      const dot = document.createElement('i');
      dot.style.setProperty('--c', it.color);
      const count = nodes.filter((n) => MODES[mode].pick(n) === it.key).length;
      b.append(dot, document.createTextNode(`${it.label} · ${count}`));
      b.addEventListener('click', () => { filter = filter === it.key ? null : it.key; sel = null; paintLegend(); paint(); });
      li.appendChild(b);
      legendEl.appendChild(li);
    });
  }

  modeBtns.forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode; filter = null;
    modeBtns.forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    paintLegend(); paint();
  }));
  // roving radio keys for the mode switch
  modeBtns.forEach((b, i) => b.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = modeBtns[(i + d + modeBtns.length) % modeBtns.length];
    n.focus(); n.click();
  }));

  /* ---------- keyboard: arrow through contexts ---------- */
  stage.addEventListener('keydown', (e) => {
    const pos = sel === null ? -1 : order.indexOf(sel);
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = order[(pos + 1) % order.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = order[(pos - 1 + order.length) % order.length];
    else if (e.key === 'Home') next = order[0];
    else if (e.key === 'End') next = order[order.length - 1];
    else if (e.key === 'Escape') { sel = null; paint(); return; }
    if (next === null) return;
    e.preventDefault(); sel = next; hover = null; paint();
  });

  /* ---------- pulses: CloudEvents travelling along real routes ---------- */
  let focusIdx = null, running = false, raf = 0, last = 0, visible = true;
  const pulses = [];
  const MAX = () => (focusIdx !== null ? 7 : 10);
  const bez = (e, t) => {
    const u = 1 - t;
    return [u * u * e.A.x + 2 * u * t * e.cx + t * t * e.B.x, u * u * e.A.y + 2 * u * t * e.cy + t * t * e.B.y];
  };
  function spawn() {
    const pool = focusIdx !== null ? adjEdges[focusIdx] : null;
    const i = pool ? pool[(Math.random() * pool.length) | 0] : (Math.random() * edges.length) | 0;
    if (i === undefined) return;
    const c = el('circle', { r: 3.4, class: 'map-pulse', opacity: 0 }, gPulses);
    pulses.push({ e: edgeEls[i], c, t: 0, dur: 1300 + Math.random() * 1300 });
  }
  function tick(ts) {
    if (!running) return;
    const dt = Math.min(64, ts - (last || ts)); last = ts;
    for (let k = pulses.length - 1; k >= 0; k--) {
      const p = pulses[k];
      p.t += dt / p.dur;
      if (p.t >= 1) { p.c.remove(); pulses.splice(k, 1); continue; }
      const [x, y] = bez(p.e, p.t);
      p.c.setAttribute('cx', x.toFixed(1)); p.c.setAttribute('cy', y.toFixed(1));
      p.c.setAttribute('opacity', (Math.sin(Math.PI * p.t) * 0.95).toFixed(2));
    }
    while (pulses.length < MAX() && Math.random() < 0.25) spawn();
    raf = requestAnimationFrame(tick);
  }
  const update = () => {
    const want = !reduce && visible && !document.hidden;
    if (want && !running) { running = true; last = 0; raf = requestAnimationFrame(tick); }
    else if (!want && running) { running = false; cancelAnimationFrame(raf); pulses.splice(0).forEach((p) => p.c.remove()); }
  };
  if ('IntersectionObserver' in window) new IntersectionObserver(([en]) => { visible = en.isIntersecting; update(); }, { threshold: 0.1 }).observe(stage);
  document.addEventListener('visibilitychange', update);

  /* ---------- idle tour: walk the Core contexts until the visitor takes over ---------- */
  let engaged = false, tourPos = 0, tourTimer = 0;
  const core = order.filter((i) => nodes[i].k === 'Core');
  const stopTour = () => {
    if (engaged) return;
    engaged = true; clearInterval(tourTimer);
    info.setAttribute('aria-live', 'polite');
    if (tour !== null) { tour = null; paint(); }
  };
  if (!reduce) {
    info.setAttribute('aria-live', 'off');
    const step = () => { if (engaged || !visible || document.hidden || sel !== null || hover !== null) return; tour = core[tourPos++ % core.length]; paint(); };
    setTimeout(step, 1400);
    tourTimer = setInterval(step, 4200);
    ['pointerdown', 'keydown', 'focusin'].forEach((ev) => root.addEventListener(ev, stopTour));
    stage.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') stopTour(); });
  }

  paintLegend();
  paint();
  update();
})();

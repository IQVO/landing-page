// Navigation, scroll reveal, section highlighting, tabs, bars. No dependencies.
(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---- mobile menu ---- */
  const nav = $('.nav');
  const toggle = $('.nav__toggle');
  const setMenu = (open) => {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));
  $$('.nav__menu a').forEach((a) => a.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) { setMenu(false); toggle.focus(); }
  });
  matchMedia('(min-width: 1001px)').addEventListener('change', () => setMenu(false));

  /* ---- reveal on scroll ---- */
  const reveals = $$('.reveal');
  if (reduce || !('IntersectionObserver' in window)) {
    reveals.forEach((el) => el.classList.add('is-in'));
  } else {
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach((el) => io.observe(el));
  }

  /* ---- current section in the nav ---- */
  const links = new Map($$('.nav__links a').map((a) => [a.getAttribute('href').slice(1), a]));
  if ('IntersectionObserver' in window) {
    const seen = new Map();
    const so = new IntersectionObserver((entries) => {
      for (const en of entries) seen.set(en.target.id, en.isIntersecting ? en.intersectionRatio : 0);
      let best = null, max = 0;
      for (const [id, r] of seen) if (r > max) { max = r; best = id; }
      links.forEach((a, id) => (id === best ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
    }, { rootMargin: '-20% 0px -45% 0px', threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
    links.forEach((_, id) => { const s = document.getElementById(id); if (s) so.observe(s); });
  }

  /* ---- bars: native <progress> already holds the final value; animate it up when scrolled into view ---- */
  window.iqvoGrow = (el, dur = 900) => {
    if (el.dataset.to === undefined) el.dataset.to = el.getAttribute('value') || '0'; // the value attribute reflects el.value
    const to = Number(el.dataset.to) || 0;
    if (reduce || !to) return;
    const t0 = performance.now();
    el.value = 0;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      el.value = to * (1 - Math.pow(1 - k, 3));
      if (k < 1) requestAnimationFrame(step); else el.value = to;
    };
    requestAnimationFrame(step);
  };
  const bars = $$('.bars progress');
  if ('IntersectionObserver' in window && !reduce) {
    bars.forEach((b) => { b.dataset.to = b.getAttribute('value'); b.value = 0; });
    const bo = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { window.iqvoGrow(en.target); bo.unobserve(en.target); }
    }, { threshold: 0.6 });
    bars.forEach((b) => bo.observe(b));
  }

  /* ---- tabs (incident explorer): progressive enhancement of stacked panels ---- */
  $$('[data-tabs]').forEach((wrap) => {
    const list = $('[data-tablist]', wrap);
    const tabs = $$('[data-tab]', list);
    const panels = $$('[data-panel]', wrap);
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-orientation', matchMedia('(max-width: 860px)').matches ? 'horizontal' : 'vertical');
    tabs.forEach((t) => {
      const p = panels.find((x) => x.dataset.panel === t.dataset.tab);
      t.id = 'tab-' + t.dataset.tab; p.id = 'panel-' + t.dataset.tab;
      t.setAttribute('role', 'tab'); t.setAttribute('aria-controls', p.id);
      p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', t.id);
    });
    const select = (tab, focus) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        const p = document.getElementById(t.getAttribute('aria-controls'));
        p.hidden = !on;
        p.classList.toggle('is-in', on && !reduce);
      });
      if (focus) tab.focus();
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', (e) => {
        const k = e.key; let n = null;
        if (k === 'ArrowDown' || k === 'ArrowRight') n = tabs[(i + 1) % tabs.length];
        else if (k === 'ArrowUp' || k === 'ArrowLeft') n = tabs[(i - 1 + tabs.length) % tabs.length];
        else if (k === 'Home') n = tabs[0];
        else if (k === 'End') n = tabs[tabs.length - 1];
        if (n) { e.preventDefault(); select(n, true); }
      });
    });
    select(tabs[0]);
  });
})();

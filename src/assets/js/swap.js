// "Swap the model" interaction: the first box changes, the pipeline does not.
(() => {
  'use strict';
  const root = document.querySelector('[data-swap]');
  if (!root) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const models = [...root.querySelectorAll('.model')];
  const stages = [...root.querySelectorAll('.stage')];
  const nameEl = root.querySelector('[data-swap-name]');
  const verdict = root.querySelector('[data-swap-verdict]');
  let timers = [];

  // model bars are native <progress> elements; animate them the first time the section is seen
  const growBars = () => models.forEach((m) => window.iqvoGrow && window.iqvoGrow(m.querySelector('.model__bar')));

  const say = (m) => {
    const n = m.dataset.n;
    verdict.textContent = '';
    const a = document.createElement('div');
    a.textContent = `✓ ${m.dataset.model}: same ${stages.length} stages, same gates. Nothing in the pipeline asks who wrote the diff.`;
    const b = document.createElement('span');
    b.textContent = (n ? n + ' ' : '') + m.dataset.note;
    verdict.append(a, b);
  };

  const run = (m) => {
    timers.forEach(clearTimeout); timers = [];
    stages.forEach((s) => s.classList.remove('is-lit'));
    verdict.textContent = reduce ? '' : `Running ${m.dataset.model} through the same gates…`;
    nameEl.textContent = m.dataset.model;
    if (reduce) { stages.forEach((s) => s.classList.add('is-lit')); say(m); return; }
    stages.forEach((s, i) => timers.push(setTimeout(() => s.classList.add('is-lit'), 90 + i * 130)));
    timers.push(setTimeout(() => say(m), 90 + stages.length * 130 + 60));
  };

  const select = (m, focus) => {
    models.forEach((x) => { x.setAttribute('aria-checked', String(x === m)); x.tabIndex = x === m ? 0 : -1; });
    if (focus) m.focus();
    run(m);
  };

  models.forEach((m, i) => {
    m.addEventListener('click', () => select(m));
    m.addEventListener('keydown', (e) => {
      let n = null;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') n = models[(i + 1) % models.length];
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') n = models[(i - 1 + models.length) % models.length];
      if (n) { e.preventDefault(); select(n, true); }
    });
  });

  models.forEach((x, i) => { x.tabIndex = i === 0 ? 0 : -1; });
  stages.forEach((s) => s.classList.add('is-lit')); // meaningful static state before the first run
  say(models[0]);

  // play the first run when the section scrolls into view
  if ('IntersectionObserver' in window && !reduce) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { growBars(); run(models.find((m) => m.getAttribute('aria-checked') === 'true')); io.disconnect(); }
    }, { threshold: 0.35 });
    io.observe(root);
  }
})();

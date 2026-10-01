/* مؤثرات الواجهة: مشهد 3D + ميل الكروت مع الماوس + عدّاد أرقام + ريبل للأزرار */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;

  // مشهد الخلفية
  const lookup = document.getElementById('lookup-view');
  if (lookup) {
    const face = '<span></span>'.repeat(6);
    lookup.insertAdjacentHTML('afterbegin',
      `<div class="scene" aria-hidden="true"><div class="cube c1">${face}</div><div class="cube c2">${face}</div>` +
      '<i class="orb o1"></i><i class="orb o2"></i><i class="orb o3"></i><i class="halo"></i><i class="halo h2"></i></div>');
  }

  // ميل 3D + بقعة ضوء تتبع الماوس
  if (fine) {
    const SEL = '.code-card, .student-head, .card';
    let raf = 0;
    document.addEventListener('pointermove', (e) => {
      const el = e.target.closest && e.target.closest(SEL);
      if (!el) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        const max = el.classList.contains('card') && !el.classList.contains('figures') ? 2.5 : 5;
        el.style.setProperty('--ry', ((x - .5) * max * 2).toFixed(2) + 'deg');
        el.style.setProperty('--rx', ((.5 - y) * max * 2).toFixed(2) + 'deg');
        el.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
        el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
      });
    }, { passive: true });
    document.addEventListener('pointerout', (e) => {
      const el = e.target.closest && e.target.closest(SEL);
      if (el && !el.contains(e.relatedTarget)) { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); }
    });
  }

  // ريبل على الأزرار
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('.btn-primary, .btn-ghost');
    if (!b || b.disabled) return;
    const r = b.getBoundingClientRect(), s = document.createElement('span');
    s.className = 'rip'; s.style.left = (e.clientX - r.left) + 'px'; s.style.top = (e.clientY - r.top) + 'px';
    b.appendChild(s); setTimeout(() => s.remove(), 700);
  });

  // عدّاد الأرقام عند ظهور التقرير
  const report = document.getElementById('report-view');
  if (report) {
    new MutationObserver(() => {
      report.querySelectorAll('.gauge-pct, .fig dd, .donut-center b').forEach((el) => {
        const n = el.firstChild;
        if (!n || n.nodeType !== 3) return;
        const m = n.nodeValue.trim().match(/^(\d+)(%?)$/);
        if (!m) return;
        const end = +m[1], suffix = m[2], t0 = performance.now(), dur = 1300;
        const tick = (t) => {
          const k = Math.min((t - t0) / dur, 1), v = Math.round(end * (1 - Math.pow(1 - k, 3)));
          n.nodeValue = v + suffix;
          if (k < 1) requestAnimationFrame(tick);
        };
        n.nodeValue = '0' + suffix; requestAnimationFrame(tick);
      });
    }).observe(report, { childList: true });
  }
})();

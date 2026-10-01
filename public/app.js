(() => {
  'use strict';

  // =====================================================================
  // أدوات مساعدة
  // =====================================================================
  const $ = (sel, root = document) => root.querySelector(sel);

  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const LEVEL_COLORS = {
    excellent: '#0D9488',
    very_good: '#65A30D',
    good: '#CA8A04',
    pass: '#EA580C',
    weak: '#E11D48',
  };
  const BRAND = '#0D9488';
  const ROSE = '#E11D48';
  const MUTED = '#64748B';

  const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };

  const pct = (n) => `${Math.round(n * 10) / 10}%`;
  const int = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 });

  const parseDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? new Date(`${v}T12:00:00`) : new Date(v));
  const fmtDate = (v) =>
    new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }).format(parseDate(v));
  const fmtDayShort = (v) =>
    new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' }).format(parseDate(v));
  const monthDate = (m) => {
    const [y, mo] = m.split('-').map(Number);
    return new Date(y, mo - 1, 1);
  };
  const fmtMonth = (m) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { month: 'long', year: 'numeric' }).format(monthDate(m));
  const fmtMonthShort = (m) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { month: 'short' }).format(monthDate(m));

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // =====================================================================
  // إعدادات Chart.js العامة (عربي + RTL في التلميحات)
  // =====================================================================
  Chart.defaults.locale = 'en-US'; // أرقام إنجليزية في محاور الرسوم مثل باقي الصفحة
  Chart.defaults.font.family = "'Tajawal', system-ui, sans-serif";
  Chart.defaults.font.size = 13;
  Chart.defaults.color = MUTED;
  if (reduceMotion) Chart.defaults.animation = false;

  const tooltipBase = {
    rtl: true,
    textDirection: 'rtl',
    backgroundColor: '#0F172A',
    padding: 12,
    cornerRadius: 10,
    titleFont: { weight: '700', size: 14 },
    bodyFont: { size: 13.5 },
    boxPadding: 5,
  };

  let charts = [];
  const destroyCharts = () => {
    charts.forEach((c) => c.destroy());
    charts = [];
  };

  // إبرة مقياس المستوى (Plugin مخصص)
  const needlePlugin = {
    id: 'needle',
    afterDatasetsDraw(chart, args, opts) {
      const arc = chart.getDatasetMeta(0).data[0];
      if (!arc || opts.value == null) return;
      const { ctx } = chart;
      const v = Math.min(Math.max(opts.value, 0), 100);
      const angle = Math.PI + (v / 100) * Math.PI;
      const mid = (arc.innerRadius + arc.outerRadius) / 2;

      ctx.save();
      ctx.translate(arc.x, arc.y);
      ctx.rotate(angle);

      // الإبرة
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(arc.innerRadius - 6, 0);
      ctx.lineTo(0, 5);
      ctx.closePath();
      ctx.fillStyle = '#0F172A';
      ctx.fill();

      // علامة موضع الطالب على الشريط الملوّن
      ctx.beginPath();
      ctx.arc(mid, 0, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#0F172A';
      ctx.stroke();
      ctx.restore();

      // مركز الإبرة
      ctx.save();
      ctx.beginPath();
      ctx.arc(arc.x, arc.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#0F172A';
      ctx.fill();
      ctx.restore();
    },
  };

  // =====================================================================
  // عناصر الصفحة
  // =====================================================================
  const lookupView = $('#lookup-view');
  const reportView = $('#report-view');
  const form = $('#lookup-form');
  const input = $('#code-input');
  const submitBtn = $('#code-submit');
  const errorBox = $('#code-error');

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = !msg;
  }

  // =====================================================================
  // الإعدادات العامة: اسم المركز واسم المدرس
  // =====================================================================
  function applyTeacher(name) {
    const chip = $('#teacher-chip');
    if (name) {
      $('#teacher-name').textContent = name;
      chip.hidden = false;
    } else {
      chip.hidden = true;
    }
  }

  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      const cfg = await res.json();
      if (!cfg.success) return;
      $('#center-name').textContent = cfg.center_name;
      $('#footer-name').textContent = cfg.center_name;
      $('#brand-mark').textContent = Array.from(cfg.center_name.trim())[0] || 'م';
      document.title = `بوابة ولي الأمر — ${cfg.center_name}`;
      applyTeacher(cfg.teacher_name);
    } catch (_) {
      /* الصفحة تشتغل بالقيم الافتراضية */
    }
  }

  // =====================================================================
  // البحث بالكود
  // =====================================================================
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = input.value.trim();
    if (!code) {
      showError('اكتب كود الطالب أولًا.');
      input.focus();
      return;
    }

    showError('');
    submitBtn.disabled = true;
    submitBtn.textContent = 'جاري التحميل...';

    try {
      const res = await fetch('/api/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({ success: false, message: 'حدث خطأ غير متوقع.' }));
      if (!data.success) {
        showError(data.message || 'تعذّر تحميل البيانات.');
        input.select();
        return;
      }
      renderReport(data);
    } catch (_) {
      showError('تعذّر الاتصال بالسيرفر. تأكد من اتصالك بالإنترنت وحاول مرة أخرى.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'عرض التقرير';
    }
  });

  function backToLookup() {
    destroyCharts();
    reportView.hidden = true;
    reportView.innerHTML = '';
    lookupView.hidden = false;
    input.value = '';
    showError('');
    window.scrollTo({ top: 0 });
    input.focus();
  }

  // =====================================================================
  // بناء التقرير
  // =====================================================================
  const levelColor = (key) => LEVEL_COLORS[key] || MUTED;

  function levelRanges(levels) {
    // levels مرتبة من الأعلى للأدنى
    return levels.map((l, i) => {
      const upper = i === 0 ? 100 : levels[i - 1].min - 1;
      const text = i === 0 ? `<bdi dir="ltr">${l.min}+</bdi>` : l.min === 0 ? `أقل من <bdi dir="ltr">${levels[i - 1].min}</bdi>` : `<bdi dir="ltr">${l.min}–${upper}</bdi>`;
      return { ...l, text };
    });
  }

  function trendHtml(t) {
    if (!t) return `<p class="trend">يظهر اتجاه المستوى بعد امتحانين على الأقل.</p>`;
    if (t.direction === 'up')
      return `<p class="trend up">▲ <b>تحسّن بمقدار ${int(t.delta)} نقطة</b> مقارنة بالامتحانات السابقة.</p>`;
    if (t.direction === 'down')
      return `<p class="trend down">▼ <b>تراجع بمقدار ${int(t.delta)} نقطة</b> مقارنة بالامتحانات السابقة.</p>`;
    return `<p class="trend">المستوى <b>مستقر</b> مقارنة بالامتحانات السابقة.</p>`;
  }

  function vsGroupHtml(e) {
    if (e.group_avg === null || e.group_avg === undefined) return `<span class="vs-group none">—</span>`;
    const diff = Math.round((e.percent - e.group_avg) * 10) / 10;
    let cls = 'same';
    let txt = 'قريب من المتوسط';
    if (diff >= 1) {
      cls = 'up';
      txt = `أعلى بـ ${int(diff)} نقطة`;
    } else if (diff <= -1) {
      cls = 'down';
      txt = `أقل بـ ${int(Math.abs(diff))} نقطة`;
    }
    return `<span class="vs-group ${cls}"><b>${pct(e.group_avg)}</b> <small>${txt}</small></span>`;
  }

  function examsSection(d) {
    const levelLabel = Object.fromEntries(d.levels.map((l) => [l.key, l.label]));
    if (!d.exams.length) return '';
    const rows = [...d.exams]
      .reverse()
      .map(
        (e) => `
        <tr>
          <td class="exam-name">${esc(e.name)}</td>
          <td class="exam-date" data-label="التاريخ"><span class="v">${esc(fmtDate(e.date))}</span></td>
          <td class="exam-score" data-label="الدرجة"><span class="v">${int(e.score)} <small>من ${int(e.total)}</small></span></td>
          <td class="meter-cell" data-label="النسبة">
            <div class="meter">
              <span class="meter-track"><i style="width:${Math.min(e.percent, 100)}%;background:${levelColor(e.level)}"></i></span>
              <b>${pct(e.percent)}</b>
            </div>
          </td>
          <td data-label="المستوى"><span class="v"><span class="level-pill"><i style="background:${levelColor(e.level)}"></i>${esc(levelLabel[e.level] || '')}</span></span></td>
          <td data-label="متوسط المجموعة"><span class="v">${vsGroupHtml(e)}</span></td>
        </tr>`
      )
      .join('');

    return `
      <section class="card" aria-labelledby="exams-title">
        <h2 id="exams-title">سجل الامتحانات</h2>
        <p class="sub">من الأحدث إلى الأقدم.</p>
        <div class="table-scroll">
          <table class="exams-table">
            <thead>
              <tr><th>الامتحان</th><th>التاريخ</th><th>الدرجة</th><th>النسبة</th><th>المستوى</th><th>متوسط المجموعة</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>`;
  }

  function renderReport(d) {
    destroyCharts();

    const { summary: s, attendance: a, financial: f, group: g } = d;
    const hasExams = d.exams.length > 0;
    const hasAttendance = a.present + a.absent > 0;
    const hasGroupAvg = d.exams.some((e) => e.group_avg !== null && e.group_avg !== undefined);
    const ranges = levelRanges(d.levels);

    // ----- شارة الاشتراك -----
    let payBadge;
    if (f.is_free) payBadge = `<span class="badge free">معفى من الاشتراك</span>`;
    else if (f.has_paid_current_month) payBadge = `<span class="badge ok">تم سداد شهر ${esc(fmtMonth(f.current_month))}</span>`;
    else payBadge = `<span class="badge bad">لم يُسدَّد شهر ${esc(fmtMonth(f.current_month))}</span>`;

    // ----- الرأس -----
    const head = `
      <header class="student-head">
        <div class="student-head-top">
          <div>
            <p class="student-code">كود الطالب <bdi>${esc(d.student.code)}</bdi></p>
            <h1 class="student-name">${esc(d.student.name)}</h1>
          </div>
          <div class="head-actions">
            <button type="button" class="btn-ghost" id="btn-print">طباعة التقرير</button>
            <button type="button" class="btn-ghost" id="btn-new">بحث بكود آخر</button>
          </div>
        </div>
        <dl class="facts">
          ${d.teacher_name ? `<div class="fact fact-teacher"><dt>المدرس</dt><dd>${esc(d.teacher_name)}</dd></div>` : ''}
          <div class="fact"><dt>المجموعة</dt><dd>${g ? esc(g.name) : 'غير محددة'}</dd></div>
          ${g && g.days ? `<div class="fact"><dt>مواعيد الحصص</dt><dd>${esc(g.days)}</dd></div>` : ''}
          <div class="fact"><dt>الاشتراك</dt><dd>${payBadge}</dd></div>
        </dl>
      </header>`;

    // ----- المستوى + تطور الدرجات -----
    let levelRow;
    if (hasExams) {
      levelRow = `
      <div class="row-level">
        <section class="card" aria-labelledby="level-title">
          <h2 id="level-title">المستوى العام</h2>
          <p class="sub">متوسط نسب ${int(s.exams_count)} ${s.exams_count === 1 ? 'امتحان' : 'امتحانات'}.</p>
          <div class="chart-box gauge"><canvas id="chart-gauge" role="img"
            aria-label="مقياس المستوى: ${esc(pct(s.average))} — ${esc(s.level.label)}"></canvas></div>
          <div class="gauge-readout">
            <div class="gauge-pct">${int(s.average)}<small>%</small></div>
            <span class="gauge-level" style="background:${levelColor(s.level.key)}">${esc(s.level.label)}</span>
          </div>
          ${trendHtml(s.trend)}
          <div class="scale" aria-label="تقسيم المستويات">
            ${[...ranges].reverse().map((r) => `<span><i style="background:${levelColor(r.key)}"></i>${esc(r.label)} ${r.text}</span>`).join('')}
          </div>
        </section>

        <section class="card" aria-labelledby="trend-title">
          <h2 id="trend-title">تطور الدرجات</h2>
          <p class="sub">نسبة الطالب في كل امتحان${hasGroupAvg ? '، مقارنةً بمتوسط مجموعته' : ''}.</p>
          <div class="chart-box tall"><canvas id="chart-trend" role="img"
            aria-label="رسم بياني لتطور نسب الطالب في ${int(s.exams_count)} امتحان"></canvas></div>
        </section>
      </div>

      <dl class="card figures">
        <div class="fig"><dt>عدد الامتحانات</dt><dd>${int(s.exams_count)}</dd></div>
        <div class="fig"><dt>أعلى نسبة</dt><dd>${pct(s.best.percent)}<small>${esc(s.best.name)}</small></dd></div>
        <div class="fig"><dt>أقل نسبة</dt><dd>${pct(s.lowest.percent)}<small>${esc(s.lowest.name)}</small></dd></div>
        <div class="fig"><dt>نسبة الحضور</dt><dd>${a.rate === null ? '—' : a.rate + '%'}<small>${hasAttendance ? `حضر ${int(a.present)} من ${int(a.present + a.absent)} حصة` : 'لا توجد حصص مسجلة'}</small></dd></div>
      </dl>`;
    } else {
      levelRow = `
      <section class="card">
        <h2>المستوى والدرجات</h2>
        <p class="empty">لم تُسجَّل درجات لهذا الطالب بعد. سيظهر هنا مستواه ورسم تطور الدرجات فور رصد أول امتحان.</p>
      </section>`;
    }

    // ----- الحضور -----
    let attendanceRow;
    if (hasAttendance) {
      attendanceRow = `
      <div class="row-attendance">
        <section class="card" aria-labelledby="att-title">
          <h2 id="att-title">الحضور والغياب شهريًا</h2>
          <p class="sub">آخر ${Math.min(6, a.by_month.length)} ${a.by_month.length === 1 ? 'شهر' : 'شهور'} فيها حصص مسجلة.</p>
          <div class="chart-box mid"><canvas id="chart-attendance" role="img"
            aria-label="أعمدة الحضور والغياب لكل شهر"></canvas></div>
        </section>
        <section class="card" aria-labelledby="rate-title">
          <h2 id="rate-title">نسبة الالتزام</h2>
          <p class="sub">إجمالي الحصص المسجلة.</p>
          <div class="donut-wrap">
            <div class="chart-box donut"><canvas id="chart-donut" role="img"
              aria-label="نسبة الحضور ${a.rate}%"></canvas></div>
            <div class="donut-center"><b>${a.rate}%</b><span>حضور</span></div>
          </div>
          <div class="donut-legend">
            <span><i style="background:${BRAND}"></i>حاضر ${int(a.present)}</span>
            <span><i style="background:${ROSE}"></i>غائب ${int(a.absent)}</span>
          </div>
        </section>
      </div>`;
    } else {
      attendanceRow = `
      <section class="card">
        <h2>الحضور والغياب</h2>
        <p class="empty">لا توجد حصص مسجلة لهذا الطالب حتى الآن.</p>
      </section>`;
    }

    // ----- الاشتراكات + آخر الحصص -----
    const monthsHtml = f.is_free
      ? `<p class="free-note">الطالب معفى من الاشتراك الشهري.</p>`
      : f.months.length
        ? `<div class="months">${f.months
            .map(
              (m) => `
              <div class="month ${m.paid ? 'paid' : 'unpaid'}">
                <b>${esc(fmtMonth(m.month))}</b>
                <span>${m.paid ? 'تم السداد' : 'لم يُسدَّد'}</span>
                ${m.paid && m.amount ? `<span class="amt">${int(m.amount)} ج.م</span>` : ''}
              </div>`
            )
            .join('')}</div>`
        : `<p class="empty">لا توجد شهور اشتراك بعد.</p>`;

    const recentHtml = a.recent.length
      ? `<ul class="chips">${a.recent
          .map(
            (r) => `<li><time datetime="${esc(r.date)}">${esc(fmtDayShort(r.date))}</time>
              <span class="st ${r.status === 'حاضر' ? 'present' : 'absent'}">${esc(r.status)}</span></li>`
          )
          .join('')}</ul>`
      : `<p class="empty">لا توجد حصص مسجلة.</p>`;

    const bottom = `
      <div class="row-bottom">
        <section class="card" aria-labelledby="pay-title">
          <h2 id="pay-title">حالة الاشتراك</h2>
          <p class="sub">آخر 12 شهرًا.</p>
          ${monthsHtml}
        </section>
        <section class="card" aria-labelledby="recent-title">
          <h2 id="recent-title">آخر الحصص</h2>
          <p class="sub">أحدث 10 حصص مسجلة.</p>
          ${recentHtml}
        </section>
      </div>`;

    reportView.innerHTML = head + levelRow + attendanceRow + examsSection(d) + bottom;
    lookupView.hidden = true;
    reportView.hidden = false;
    window.scrollTo({ top: 0 });

    $('#btn-new').addEventListener('click', backToLookup);
    $('#btn-print').addEventListener('click', () => window.print());
    if (d.teacher_name) applyTeacher(d.teacher_name);

    if (hasExams) {
      drawGauge(d);
      drawTrend(d, hasGroupAvg);
    }
    if (hasAttendance) {
      drawAttendance(a);
      drawDonut(a);
    }
  }

  // =====================================================================
  // الرسوم البيانية
  // =====================================================================
  function drawGauge(d) {
    const asc = [...d.levels].sort((x, y) => x.min - y.min);
    const widths = asc.map((l, i) => (i === asc.length - 1 ? 100 : asc[i + 1].min) - l.min);
    const avg = d.summary.average;
    const current = d.summary.level.key;

    charts.push(
      new Chart($('#chart-gauge'), {
        type: 'doughnut',
        data: {
          labels: asc.map((l) => l.label),
          datasets: [
            {
              data: widths,
              backgroundColor: asc.map((l) => (l.key === current ? levelColor(l.key) : rgba(levelColor(l.key), 0.32))),
              borderWidth: 3,
              borderColor: '#fff',
              borderRadius: 4,
            },
          ],
        },
        options: {
          rotation: -90,
          circumference: 180,
          cutout: '68%',
          aspectRatio: 2 / 1.06,
          layout: { padding: { bottom: 6 } },
          plugins: { legend: { display: false }, tooltip: { enabled: false }, needle: { value: avg } },
        },
        plugins: [needlePlugin],
      })
    );
  }

  function drawTrend(d, hasGroupAvg) {
    const exams = d.exams;
    const datasets = [
      {
        label: 'نسبة الطالب',
        data: exams.map((e) => e.percent),
        borderColor: BRAND,
        backgroundColor: rgba(BRAND, 0.1),
        fill: true,
        tension: 0.28,
        borderWidth: 3,
        pointRadius: 6,
        pointHoverRadius: 8,
        pointBackgroundColor: exams.map((e) => levelColor(e.level)),
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        order: 1,
      },
    ];
    if (hasGroupAvg) {
      datasets.push({
        label: 'متوسط المجموعة',
        data: exams.map((e) => e.group_avg),
        borderColor: MUTED,
        borderDash: [7, 5],
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: MUTED,
        fill: false,
        tension: 0.28,
        spanGaps: true,
        order: 2,
      });
    }
    datasets.push({
      label: 'حد النجاح 50%',
      data: exams.map(() => 50),
      borderColor: rgba(ROSE, 0.55),
      borderDash: [2, 4],
      borderWidth: 1.5,
      pointRadius: 0,
      pointHoverRadius: 0,
      fill: false,
      order: 3,
    });
    const passIdx = datasets.length - 1;

    charts.push(
      new Chart($('#chart-trend'), {
        type: 'line',
        data: { labels: exams.map((e) => fmtDayShort(e.date)), datasets },
        options: {
          maintainAspectRatio: false,
          datasets: { line: { clip: 10 } },
          interaction: { mode: 'index', intersect: false },
          layout: { padding: { top: 16, left: 4, right: 10 } },
          scales: {
            y: { min: 0, max: 100, ticks: { stepSize: 25, callback: (v) => `${v}%` }, grid: { color: '#EAEEF2' }, border: { display: false } },
            x: {
              grid: { display: false },
              ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
            },
          },
          plugins: {
            legend: {
              rtl: true,
              textDirection: 'rtl',
              position: 'bottom',
              labels: {
                usePointStyle: true,
                boxWidth: 8,
                boxHeight: 8,
                padding: 18,
                generateLabels: (chart) =>
                  Chart.defaults.plugins.legend.labels
                    .generateLabels(chart)
                    .map((l) => (l.datasetIndex === 0 ? { ...l, fillStyle: BRAND, strokeStyle: BRAND } : l)),
              },
            },
            tooltip: {
              ...tooltipBase,
              filter: (item) => item.datasetIndex !== passIdx,
              callbacks: {
                title: (items) => {
                  const e = exams[items[0].dataIndex];
                  return `${e.name} — ${fmtDate(e.date)}`;
                },
                label: (item) => {
                  const e = exams[item.dataIndex];
                  if (item.datasetIndex === 0) return `الدرجة: ${int(e.score)} من ${int(e.total)} (${pct(e.percent)})`;
                  return `متوسط المجموعة: ${pct(item.parsed.y)}`;
                },
              },
            },
          },
        },
      })
    );
  }

  function drawAttendance(a) {
    const months = a.by_month.slice(-6);
    charts.push(
      new Chart($('#chart-attendance'), {
        type: 'bar',
        data: {
          labels: months.map((m) => fmtMonthShort(m.month)),
          datasets: [
            { label: 'حاضر', data: months.map((m) => m.present), backgroundColor: BRAND, borderRadius: 6, borderSkipped: false, maxBarThickness: 38 },
            { label: 'غائب', data: months.map((m) => m.absent), backgroundColor: ROSE, borderRadius: 6, borderSkipped: false, maxBarThickness: 38 },
          ],
        },
        options: {
          maintainAspectRatio: false,
          scales: {
            x: { stacked: true, grid: { display: false } },
            y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#EAEEF2' }, border: { display: false } },
          },
          plugins: {
            legend: { rtl: true, textDirection: 'rtl', position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 18 } },
            tooltip: {
              ...tooltipBase,
              callbacks: {
                title: (items) => fmtMonth(months[items[0].dataIndex].month),
                label: (item) => `${item.dataset.label}: ${int(item.parsed.y)} حصة`,
              },
            },
          },
        },
      })
    );
  }

  function drawDonut(a) {
    charts.push(
      new Chart($('#chart-donut'), {
        type: 'doughnut',
        data: {
          labels: ['حاضر', 'غائب'],
          datasets: [{ data: [a.present, a.absent], backgroundColor: [BRAND, ROSE], borderWidth: 3, borderColor: '#fff', borderRadius: 4 }],
        },
        options: {
          maintainAspectRatio: false,
          cutout: '74%',
          plugins: {
            legend: { display: false },
            tooltip: { ...tooltipBase, callbacks: { label: (item) => `${item.label}: ${int(item.parsed)} حصة` } },
          },
        },
      })
    );
  }

  // =====================================================================
  // تشغيل
  // =====================================================================
  loadConfig();
  input.focus();
})();

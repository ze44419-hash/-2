// =====================================================================
// parent-portal/server.js
// بوابة ولي الأمر — سيرفر مستقل للقراءة فقط، على نفس قاعدة بيانات Supabase
// الخاصة بنظام الحضور والحسابات.
//
// ولي الأمر يكتب كود الطالب فقط، فيرجع له تقرير كامل:
// البيانات الأساسية + الدرجات والمستوى + الحضور والغياب + حالة الاشتراك.
// =====================================================================

require('dotenv').config();

const express = require('express');
const path = require('path');

// ---------------------------------------------------------------------
// الإعدادات
// ---------------------------------------------------------------------
const CENTER_NAME = process.env.CENTER_NAME || 'المركز التعليمي';
const TEACHER_NAME = (process.env.TEACHER_NAME || '').trim();
const PORT = Number(process.env.PORT) || 4000;

// تقسيم المستويات حسب متوسط نسبة الدرجات
const LEVELS = [
  { min: 85, key: 'excellent', label: 'ممتاز' },
  { min: 75, key: 'very_good', label: 'جيد جدًا' },
  { min: 65, key: 'good', label: 'جيد' },
  { min: 50, key: 'pass', label: 'مقبول' },
  { min: 0, key: 'weak', label: 'يحتاج إلى دعم' },
];

// حماية من تخمين الأكواد: عدد محاولات خاطئة مسموح لكل IP قبل القفل المؤقت
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 40;
const MAX_FAILS_PER_WINDOW = 8;
const LOCK_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------
// دوال مساعدة
// ---------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function levelFor(percent) {
  return LEVELS.find((l) => percent >= l.min) || LEVELS[LEVELS.length - 1];
}

const round1 = (n) => Math.round(n * 10) / 10;
const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);

// تحويل الأرقام العربية (٠١٢٣) للإنجليزية، وتنظيف الكود، والتحقق من شكله
function normalizeCode(raw) {
  if (raw === undefined || raw === null) return { code: '', valid: false };
  let s = String(raw).trim();
  s = s.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  s = s.replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  s = s.replace(/\s+/g, '');
  return { code: s, valid: /^[A-Za-z0-9_-]{1,40}$/.test(s) };
}

function todayMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function addMonths(monthStr, delta) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthsRange(start, end) {
  const out = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard < 240) {
    out.push(cur);
    cur = addMonths(cur, 1);
    guard++;
  }
  return out;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Supabase بيرجع 1000 صف كحد أقصى في الطلب الواحد، فنجيب على صفحات
async function fetchAll(makeQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

// ---------------------------------------------------------------------
// بناء التطبيق (بياخد عميل Supabase كمعامل)
// ---------------------------------------------------------------------
function createApp(supabase) {
  const app = express();

  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    );
    next();
  });

  app.use(express.json({ limit: '2kb' }));

  // -------------------------------------------------------------------
  // تحديد معدل الطلبات لكل IP
  // -------------------------------------------------------------------
  const ipState = new Map();

  function getState(ip) {
    const now = Date.now();
    let s = ipState.get(ip);
    if (!s || now > s.resetAt) {
      s = { requests: 0, fails: 0, resetAt: now + WINDOW_MS, lockedUntil: s ? s.lockedUntil : 0 };
      ipState.set(ip, s);
    }
    return s;
  }

  function registerFail(s) {
    s.fails += 1;
    if (s.fails >= MAX_FAILS_PER_WINDOW) {
      s.lockedUntil = Date.now() + LOCK_MS;
      s.fails = 0;
    }
  }

  function tooMany(res, ms) {
    const minutes = Math.max(1, Math.ceil(ms / 60000));
    return res.status(429).json({
      success: false,
      message: `محاولات كتير خلال وقت قصير. حاول مرة أخرى بعد ${minutes} دقيقة تقريبًا.`,
    });
  }

  setInterval(() => {
    const now = Date.now();
    for (const [ip, s] of ipState) {
      if (now > s.resetAt && now > s.lockedUntil) ipState.delete(ip);
    }
  }, WINDOW_MS).unref();

  // -------------------------------------------------------------------
  // متوسط المجموعة لكل امتحان
  // -------------------------------------------------------------------
  async function groupAverages(groupId, examNames) {
    const result = new Map();
    if (!groupId || examNames.length === 0 || !supabase) return result;

    const mates = await fetchAll(() =>
      supabase.from('students').select('id').eq('group_id', groupId).order('id', { ascending: true })
    );
    const ids = mates.map((m) => m.id);
    if (ids.length < 2) return result;

    const sums = new Map();
    for (const idsChunk of chunk(ids, 100)) {
      const rows = await fetchAll(() =>
        supabase
          .from('exam_results')
          .select('exam_name, score, total_score')
          .in('student_id', idsChunk)
          .in('exam_name', examNames)
          .order('created_at', { ascending: true })
          .order('student_id', { ascending: true })
      );
      for (const r of rows) {
        const total = Number(r.total_score);
        const score = Number(r.score);
        if (!(total > 0) || Number.isNaN(score)) continue;
        const e = sums.get(r.exam_name) || { total: 0, count: 0 };
        e.total += (score / total) * 100;
        e.count += 1;
        sums.set(r.exam_name, e);
      }
    }
    for (const [name, e] of sums) {
      if (e.count >= 2) result.set(name, round1(e.total / e.count));
    }
    return result;
  }

  // -------------------------------------------------------------------
  // تجميع تقرير الطالب الكامل
  // -------------------------------------------------------------------
  async function buildReport(code) {
    if (!supabase) throw new Error('Supabase client is not initialized.');

    const { data: student, error: stErr } = await supabase
      .from('students')
      .select('id, name, is_free, created_at, group_id')
      .eq('id', code)
      .maybeSingle();
    if (stErr) throw stErr;
    if (!student) return null;

    const [groupRes, attendanceRows, paymentRows, examRows] = await Promise.all([
      student.group_id
        ? supabase.from('groups').select('*').eq('id', student.group_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      fetchAll(() =>
        supabase
          .from('attendance')
          .select('date, status')
          .eq('student_id', student.id)
          .order('date', { ascending: true })
          .order('id', { ascending: true })
      ),
      fetchAll(() =>
        supabase
          .from('payments')
          .select('month, amount, payment_date')
          .eq('student_id', student.id)
          .order('payment_date', { ascending: true })
      ),
      fetchAll(() =>
        supabase
          .from('exam_results')
          .select('exam_name, score, total_score, created_at')
          .eq('student_id', student.id)
          .order('created_at', { ascending: true })
      ),
    ]);
    if (groupRes.error) throw groupRes.error;
    const group = groupRes.data;

    const validExams = examRows.filter((e) => Number(e.total_score) > 0 && !Number.isNaN(Number(e.score)));
    const groupAvgMap = await groupAverages(student.group_id, [...new Set(validExams.map((e) => e.exam_name))]);

    const exams = validExams.map((e) => {
      const percent = round1((Number(e.score) / Number(e.total_score)) * 100);
      return {
        name: e.exam_name,
        date: e.created_at,
        score: Number(e.score),
        total: Number(e.total_score),
        percent,
        level: levelFor(percent).key,
        group_avg: groupAvgMap.has(e.exam_name) ? groupAvgMap.get(e.exam_name) : null,
      };
    });

    const percents = exams.map((e) => e.percent);
    const average = percents.length ? round1(avg(percents)) : null;

    let trend = null;
    if (percents.length >= 2) {
      const recentN = Math.min(3, Math.floor(percents.length / 2));
      const delta = round1(avg(percents.slice(-recentN)) - avg(percents.slice(0, -recentN)));
      trend = {
        direction: delta >= 3 ? 'up' : delta <= -3 ? 'down' : 'flat',
        delta: Math.abs(delta),
      };
    }

    const best = exams.length ? exams.reduce((a, b) => (b.percent > a.percent ? b : a)) : null;
    const lowest = exams.length ? exams.reduce((a, b) => (b.percent < a.percent ? b : a)) : null;

    const summary = {
      exams_count: exams.length,
      average,
      level: average === null ? null : { key: levelFor(average).key, label: levelFor(average).label },
      trend,
      best: best && { name: best.name, percent: best.percent },
      lowest: lowest && { name: lowest.name, percent: lowest.percent },
    };

    const present = attendanceRows.filter((r) => r.status === 'حاضر').length;
    const absent = attendanceRows.filter((r) => r.status === 'غائب').length;
    const byMonthMap = new Map();
    for (const r of attendanceRows) {
      const m = String(r.date).slice(0, 7);
      const e = byMonthMap.get(m) || { month: m, present: 0, absent: 0 };
      if (r.status === 'حاضر') e.present += 1;
      else if (r.status === 'غائب') e.absent += 1;
      byMonthMap.set(m, e);
    }
    const attendance = {
      present,
      absent,
      rate: present + absent > 0 ? Math.round((present / (present + absent)) * 100) : null,
      by_month: [...byMonthMap.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
      recent: attendanceRows
        .slice(-10)
        .reverse()
        .map((r) => ({ date: String(r.date).slice(0, 10), status: r.status })),
    };

    const currentMonth = todayMonth();
    let financial;
    if (student.is_free) {
      financial = { is_free: true, current_month: currentMonth, has_paid_current_month: null, months: [] };
    } else {
      const paidMap = new Map(paymentRows.map((p) => [p.month, p]));
      const createdMonth = student.created_at ? String(student.created_at).slice(0, 7) : currentMonth;
      const startMonth = createdMonth <= currentMonth ? createdMonth : currentMonth;
      const months = monthsRange(startMonth, currentMonth)
        .map((m) => {
          const p = paidMap.get(m);
          return { month: m, paid: Boolean(p), amount: p ? Number(p.amount) : null };
        })
        .reverse()
        .slice(0, 12);
      financial = {
        is_free: false,
        current_month: currentMonth,
        has_paid_current_month: paidMap.has(currentMonth),
        months,
      };
    }

    const teacherName = (group && group.teacher_name ? String(group.teacher_name).trim() : '') || TEACHER_NAME;

    return {
      student: { code: student.id, name: student.name },
      group: group ? { name: group.name, days: group.days } : null,
      teacher_name: teacherName,
      levels: LEVELS,
      summary,
      exams,
      attendance,
      financial,
    };
  }

  // -------------------------------------------------------------------
  // المسارات (Routes)
  // -------------------------------------------------------------------
  app.get('/api/config', (req, res) => {
    res.json({ success: true, center_name: CENTER_NAME, teacher_name: TEACHER_NAME });
  });

  app.post('/api/lookup', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const ip = req.ip || 'unknown';
    const state = getState(ip);
    const now = Date.now();

    if (state.lockedUntil > now) return tooMany(res, state.lockedUntil - now);
    state.requests += 1;
    if (state.requests > MAX_REQUESTS_PER_WINDOW) return tooMany(res, state.resetAt - now);

    const { code, valid } = normalizeCode(req.body && req.body.code);

    if (!code) {
      return res.status(400).json({ success: false, message: 'اكتب كود الطالب أولًا.' });
    }
    if (!valid) {
      registerFail(state);
      await sleep(300);
      return res.status(400).json({
        success: false,
        message: 'الكود غير صحيح. الكود بيتكون من أرقام أو حروف إنجليزية فقط، راجع الكارنيه وحاول مرة أخرى.',
      });
    }

    try {
      const report = await buildReport(code);
      if (!report) {
        registerFail(state);
        await sleep(300);
        return res.status(404).json({
          success: false,
          message: 'لا يوجد طالب بهذا الكود. راجع الكود المطبوع على الكارنيه وحاول مرة أخرى.',
        });
      }
      return res.json({ success: true, ...report });
    } catch (err) {
      console.error('lookup error:', err && err.message ? err.message : err);
      return res.status(500).json({ success: false, message: 'حدث خطأ أثناء تحميل البيانات. حاول مرة أخرى بعد قليل.' });
    }
  });

  // ملفات الواجهة
  const publicDir = path.join(__dirname, 'public');
  app.use('/vendor', express.static(path.join(publicDir, 'vendor'), { maxAge: '30d' }));
  app.use('/fonts', express.static(path.join(publicDir, 'fonts'), { maxAge: '30d', immutable: true }));
  app.use(express.static(publicDir));

  // أخطاء عامة
  app.use((err, req, res, next) => {
    if (err) return res.status(400).json({ success: false, message: 'طلب غير صالح.' });
    next();
  });

  return app;
}

// ---------------------------------------------------------------------
// التهيئة والتصدير لفيرسيل (Vercel) والتشغيل المحلي
// ---------------------------------------------------------------------
const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

const app = createApp(supabase);

// تصدير التطبيق ليعمل كـ Serverless Function على Vercel
module.exports = app;

// التشغيل المحلي عند تنفيذ الملف مباشرة (node server.js)
if (require.main === module) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ لازم تضبط SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY في ملف .env');
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`✅ بوابة ولي الأمر شغالة على: http://localhost:${PORT}`);
  });
}


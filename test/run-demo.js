process.env.CENTER_NAME = process.env.CENTER_NAME || 'مركز النخبة التعليمي';
process.env.TEACHER_NAME = process.env.TEACHER_NAME || 'أ/ أحمد سمير';
const { createApp } = require('../server');
const { makeFake } = require('./fake-supabase');

const thisMonth = new Date(); 
const ym = (off) => { const d = new Date(thisMonth.getFullYear(), thisMonth.getMonth() + off, 1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };

const students = [
  { id: '482913', name: 'يوسف محمد عبد الرحمن', is_free: false, created_at: ym(-5) + '-03T10:00:00Z', group_id: 1, parent_phone: '01000000000' },
  { id: '111111', name: 'طالب آخر', is_free: false, created_at: ym(-5) + '-03T10:00:00Z', group_id: 1 },
  { id: '222222', name: 'طالبة ثانية', is_free: false, created_at: ym(-5) + '-03T10:00:00Z', group_id: 1 },
  { id: '333333', name: 'طالب معفى', is_free: true, created_at: ym(-2) + '-03T10:00:00Z', group_id: 1 },
  { id: '555555', name: 'طالب جديد بدون بيانات', is_free: false, created_at: ym(0) + '-01T10:00:00Z', group_id: null },
];
const exams = [
  ['اختبار الوحدة الأولى', 14, 20], ['كويز الجبر', 9, 10], ['اختبار الشهر', 31, 50],
  ['اختبار الوحدة الثانية', 15, 20], ['كويز الهندسة', 7, 10], ['امتحان منتصف الفصل', 38, 50],
  ['اختبار الوحدة الثالثة', 18, 20], ['كويز حساب المثلثات', 10, 10],
];
const exam_results = [];
exams.forEach(([n, s, t], i) => {
  const created_at = new Date(Date.now() - (exams.length - i) * 12 * 86400000).toISOString();
  exam_results.push({ student_id: '482913', exam_name: n, score: s, total_score: t, created_at });
  exam_results.push({ student_id: '111111', exam_name: n, score: Math.round(t * 0.7), total_score: t, created_at });
  exam_results.push({ student_id: '222222', exam_name: n, score: Math.round(t * 0.62), total_score: t, created_at });
});
const attendance = [];
let id = 1;
for (let m = -3; m <= 0; m++) {
  for (let d = 1; d <= 24; d += 3) {
    const date = `${ym(m)}-${String(d).padStart(2, '0')}`;
    if (date > new Date().toISOString().slice(0, 10)) continue;
    attendance.push({ id: id++, student_id: '482913', date, status: (d % 9 === 0 || (m === -2 && d < 8)) ? 'غائب' : 'حاضر' });
  }
}
const payments = [-5, -4, -3, -1].map((o) => ({ student_id: '482913', month: ym(o), amount: 250, payment_date: ym(o) + '-05T12:00:00Z' }));

const db = {
  students, exam_results, attendance, payments,
  groups: [{ id: 1, name: 'مجموعة الرياضيات — الصف الثالث الثانوي', days: 'السبت والثلاثاء 6 مساءً' }],
};

const app = createApp(makeFake(db));
const port = Number(process.env.PORT) || 4111;
app.listen(port, () => console.log('demo on', port));

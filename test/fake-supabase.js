// عميل Supabase وهمي في الذاكرة لاختبار السيرفر بدون اتصال حقيقي
function makeFake(db) {
  function from(table) {
    let rows = (db[table] || []).slice();
    let orders = [];
    let rangeArgs = null;
    const api = {
      select() { return api; },
      eq(col, val) { rows = rows.filter((r) => String(r[col]) === String(val)); return api; },
      in(col, vals) { rows = rows.filter((r) => vals.map(String).includes(String(r[col]))); return api; },
      order(col, opt = {}) { orders.push([col, opt.ascending !== false]); return api; },
      range(a, b) { rangeArgs = [a, b]; return api; },
      maybeSingle() { return Promise.resolve({ data: run()[0] || null, error: null }); },
      then(res, rej) { return Promise.resolve({ data: run(), error: null }).then(res, rej); },
    };
    function run() {
      let out = rows.slice();
      for (const [c, asc] of orders.slice().reverse()) {
        out.sort((x, y) => (x[c] < y[c] ? (asc ? -1 : 1) : x[c] > y[c] ? (asc ? 1 : -1) : 0));
      }
      if (rangeArgs) out = out.slice(rangeArgs[0], rangeArgs[1] + 1);
      return out;
    }
    return api;
  }
  return { from };
}
module.exports = { makeFake };

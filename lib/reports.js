'use strict';
const store = require('./store');

const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const r2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const inr = (n) => '₹' + Number(r2(n)).toLocaleString('en-IN');
const todayISO = () => new Date().toISOString().slice(0, 10);

function priceOn(priceLog, products, date, prod) {
  let best = null; for (const p of priceLog) if (p.date <= date && (!best || p.date > best.date)) best = p;
  if (!best) { const pr = products.find((x) => x.code === prod); return pr ? num(pr.price) : 0; }
  return prod === 'MS' ? num(best.ms) : num(best.hsd);
}
function calcSale(r, priceLog, products) {
  const diff = (r.close == null || r.open == null) ? 0 : r2(num(r.close) - num(r.open));
  const rate = priceOn(priceLog, products, r.date, r.prod);
  const amount = r2(diff * rate), testAmt = r2(num(r.test) * rate);
  const digital = r2(num(r.bpe1) + num(r.bpe2) + num(r.phonepe) + num(r.bphonepe1) + num(r.bphonepe2) + num(r.paytm1) + num(r.paytm2) + num(r.ongo1) + num(r.ongo2));
  return { netL: r2(diff - num(r.test)), netAmt: r2(amount - testAmt), digital, cash: r2(amount - (testAmt + digital + num(r.cr) + num(r.exp))), cr: num(r.cr) };
}
async function firmName(firmId) { const f = await store.getFirm(firmId); return f ? f.name : 'Station'; }

async function dailySales(firmId, date) {
  date = date || todayISO();
  const [priceLog, products, sales, oilSales] = await Promise.all([store.listAll(firmId, 'priceLog'), store.listAll(firmId, 'products'), store.listAll(firmId, 'dailySales'), store.listAll(firmId, 'oilSales')]);
  const rows = sales.filter((r) => r.date === date);
  let ms = 0, hsd = 0, net = 0, digital = 0, cr = 0, cash = 0;
  rows.forEach((r) => { const c = calcSale(r, priceLog, products); if (r.prod === 'MS') ms += c.netL; else hsd += c.netL; net += c.netAmt; digital += c.digital; cr += c.cr; cash += c.cash; });
  const oil = oilSales.filter((o) => o.date === date).reduce((a, b) => a + num(b.value), 0);
  const name = await firmName(firmId);
  if (!rows.length && !oil) return `*${name}*\nDaily Sales — ${date}\n\nNo sales entered for this date yet.`;
  return [`*${name}*`, `🧾 Daily Sales — ${date}`, '', `⛽ MS Petrol: ${r2(ms).toLocaleString('en-IN')} L`, `⛽ HSD Diesel: ${r2(hsd).toLocaleString('en-IN')} L`, `💰 Net Fuel Sale: ${inr(net)}`, oil ? `🛢 Oil Sale: ${inr(oil)}` : null, `📱 Digital: ${inr(digital)}`, `📒 Credit given: ${inr(cr)}`, `💵 Cash: ${inr(cash)}`].filter(Boolean).join('\n');
}
async function compliance(firmId, daysAhead = 30) {
  const today = new Date(todayISO());
  const items = (await store.listAll(firmId, 'compliance')).map((c) => { if (!c.expiry) return null; const d = Math.round((new Date(c.expiry) - today) / 864e5); return { ...c, d }; }).filter((c) => c && c.d <= daysAhead).sort((a, b) => a.d - b.d);
  if (!items.length) return null;
  return [`*${await firmName(firmId)}*`, `🛡 Compliance alerts`, '', ...items.map((c) => `• ${c.item}: ${c.d < 0 ? `EXPIRED ${-c.d}d ago` : `expires in ${c.d}d`} (${c.expiry})`)].join('\n');
}
async function outstandingCredit(firmId, threshold = 0) {
  const [custs, led] = await Promise.all([store.listAll(firmId, 'customers'), store.listAll(firmId, 'credit')]);
  const rows = custs.map((c) => { const given = led.filter((x) => x.customer === c.name).reduce((a, b) => a + num(b.given), 0); const paid = led.filter((x) => x.customer === c.name).reduce((a, b) => a + num(b.paid), 0); return { name: c.name, out: r2(num(c.opening) + given - paid), limit: num(c.limit) }; }).filter((x) => x.out > threshold).sort((a, b) => b.out - a.out);
  if (!rows.length) return null;
  const total = r2(rows.reduce((a, b) => a + b.out, 0));
  return [`*${await firmName(firmId)}*`, `📒 Outstanding Credit — total ${inr(total)}`, '', ...rows.slice(0, 15).map((r) => `• ${r.name}: ${inr(r.out)}${r.limit > 0 && r.out > r.limit ? ' ⚠OVER' : ''}`)].join('\n');
}
async function weeklyAttendance(firmId) {
  const [staff, att] = await Promise.all([store.listAll(firmId, 'staff'), store.kvGet(firmId, 'attendance', {})]);
  const active = staff.filter((s) => s.status !== 'Left');
  const end = new Date(todayISO()); const start = new Date(end); start.setDate(end.getDate() - 6);
  const days = []; for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  const lines = active.map((s) => { let p = 0, h = 0, l = 0; days.forEach((d) => { const mk = d.toISOString().slice(0, 7); const rec = (att[mk] || {})[s.id]; const m = rec && rec.marks ? rec.marks[d.getDate()] : ''; if (m === 'P') p++; else if (m === 'H') h++; else if (m === 'L') l++; }); return `• ${s.name}: ${p}P ${h}H ${l}L`; });
  return [`*${await firmName(firmId)}*`, `🗓 Weekly Attendance (${start.toISOString().slice(5, 10)} → ${end.toISOString().slice(5, 10)})`, '', ...lines].join('\n');
}
module.exports = { dailySales, compliance, outstandingCredit, weeklyAttendance };

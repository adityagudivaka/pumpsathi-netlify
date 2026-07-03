/* ============================================================
   Aditya Filling Station — Operations Platform (SPA front end)
   Talks to the Express/SQLite API (api.js). JWT auth.
   ============================================================ */
'use strict';

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const el = (t, a = {}, html) => { const e = document.createElement(t); for (const k in a) { if (k === 'class') e.className = a[k]; else if (k === 'html') e.innerHTML = a[k]; else e.setAttribute(k, a[k]); } if (html != null) e.innerHTML = html; return e; };
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const round2 = v => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthKey = d => (d || '').slice(0, 7);
function fmt(n, dec = 0) { if (n === '' || n == null || isNaN(n)) return '—'; return Number(n).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
function rupee(n, dec = 0) { if (n === '' || n == null || isNaN(n)) return '—'; return '₹' + fmt(n, dec); }
function monthLabel(mk) { if (!mk) return ''; const [y, m] = mk.split('-'); return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

let S = null;   // application state (loaded from server)

/* ---------- server-backed mutations ---------- */
async function dbCreate(coll, rec) { const row = await API.create(coll, rec); S[coll].push(row); return row; }
async function dbUpdate(coll, id, rec) { const row = await API.update(coll, id, rec); const i = S[coll].findIndex(x => x.id === id); if (i >= 0) S[coll][i] = row; return row; }
async function dbDelete(coll, id) { await API.remove(coll, id); S[coll] = S[coll].filter(x => x.id !== id); }
async function saveKV(key) { await API.setKV(key, S[key]); }

function normalize(st) {
  ['products', 'nozzles', 'staff', 'customers', 'oils', 'priceLog', 'dailySales', 'crDaily', 'credit', 'oilSales', 'oilPurchases', 'advances', 'fuelStock', 'fuelPurchases', 'expenses', 'tanker', 'cashBank', 'compliance']
    .forEach(k => { if (!Array.isArray(st[k])) st[k] = []; });
  st.station = st.station || {};
  st.payroll = st.payroll || { standardDays: 30, otRate: 50, hoursPerDay: 8 };
  st.settings = st.settings || { openingCash: 0, msCommission: 4, hsdCommission: 3, oilMarginPct: 8 };
  st.expenseCategories = st.expenseCategories || [];
  st.attendance = st.attendance || {};
  st.alerts = st.alerts || { enabled: true, recipients: [], types: { dailySales: { on: true, time: '21:30' }, compliance: { on: true, daysAhead: 30 }, outstandingCredit: { on: true, threshold: 0 }, weeklyAttendance: { on: true, weekday: 1 } } };
  st.firms = st.firms || null;
  st.permissions = st.permissions || { edit: [], view: [] };
  st.roles = st.roles || [{ v: 'admin', t: 'Pump Admin' }, { v: 'staff', t: 'Staff' }];
  return st;
}

/* ---------- role / area helpers ---------- */
const AREA_OF_VIEW = {
  dashboard: null, sales: 'sales', prices: 'sales', shifts: 'shifts', stock: 'stock', purchases: 'stock',
  cash: 'cash', credit: 'credit', oils: 'stock', expenses: 'expenses', tanker: 'stock',
  attendance: 'attendance', compliance: 'compliance', alerts: 'alerts', audit: 'audit', setup: 'setup',
};
function isOwner() { return S.user && S.user.role === 'owner'; }
function canEditArea(area) { if (!area) return true; if (isOwner()) return true; return (S.permissions.edit || []).includes(area); }
function canViewArea(area) { if (!area) return true; if (isOwner()) return true; return (S.permissions.view || []).includes(area) || canEditArea(area); }
function roleLabel(r) { const f = (S.roles || []).find(x => x.v === r); return f ? f.t : r; }

/* ============================================================
   DOMAIN COMPUTATIONS
   ============================================================ */
function priceOn(date, prod) {
  let best = null;
  for (const p of S.priceLog) { if (p.date <= date && (!best || p.date > best.date)) best = p; }
  if (!best) { const pr = S.products.find(x => x.code === prod); return pr ? pr.price : 0; }
  return prod === 'MS' ? best.ms : best.hsd;
}
function calcSale(r) {
  const diff = (r.close === '' || r.close == null || r.open === '' || r.open == null) ? 0 : round2(num(r.close) - num(r.open));
  const rate = priceOn(r.date, r.prod);
  const amount = round2(diff * rate);
  const testAmt = round2(num(r.test) * rate);
  const bpe = round2(num(r.bpe1) + num(r.bpe2));
  const ppe = round2(num(r.phonepe) + num(r.bphonepe1) + num(r.bphonepe2));
  const ptm = round2(num(r.paytm1) + num(r.paytm2));
  const ong = round2(num(r.ongo1) + num(r.ongo2));
  const digital = round2(bpe + ppe + ptm + ong);
  const netL = round2(diff - num(r.test));
  const netAmt = round2(amount - testAmt);
  const cash = round2(amount - (testAmt + digital + num(r.cr) + num(r.exp)));
  return { diff, rate, amount, testAmt, bpe, ppe, ptm, ong, digital, netL, netAmt, cash };
}
function aggSales(rows) {
  let ms = 0, hsd = 0, msRs = 0, hsdRs = 0, net = 0, digital = 0, cr = 0, cash = 0, gross = 0, testRs = 0;
  for (const r of rows) {
    const c = calcSale(r);
    if (r.prod === 'MS') { ms += c.netL; msRs += c.netAmt; } else { hsd += c.netL; hsdRs += c.netAmt; }
    net += c.netAmt; gross += c.amount; testRs += c.testAmt; digital += c.digital; cr += num(r.cr); cash += c.cash;
  }
  return { ms: round2(ms), hsd: round2(hsd), msRs: round2(msRs), hsdRs: round2(hsdRs), net: round2(net), gross: round2(gross), testRs: round2(testRs), digital: round2(digital), cr: round2(cr), cash: round2(cash) };
}
const salesInMonth = mk => S.dailySales.filter(r => monthKey(r.date) === mk);
const salesOnDate = d => S.dailySales.filter(r => r.date === d);
function activeMonths() { return [...new Set(S.dailySales.map(r => monthKey(r.date)).filter(Boolean))].sort(); }
function completeMonths() { const t = todayISO(); return activeMonths().filter(mk => { const [y, m] = mk.split('-').map(Number); return new Date(y, m, 0).toISOString().slice(0, 10) < t; }); }

/* Consolidated Report per date */
function crFor(date) { return S.crDaily.find(r => r.date === date) || { date, twoTCash: 0, custCash: 0, yDeposit: 0, tDeposit: 0 }; }
function crRow(date) {
  const rows = salesOnDate(date);
  let msL = 0, hsdL = 0, gross = 0, testRs = 0, net = 0, bpe = 0, ppe = 0, ptm = 0, ong = 0, dig = 0, cr = 0, exp = 0, cashGiven = 0;
  rows.forEach(r => { const c = calcSale(r); if (r.prod === 'MS') msL += c.netL; else hsdL += c.netL; gross += c.amount; testRs += c.testAmt; net += c.netAmt; bpe += c.bpe; ppe += c.ppe; ptm += c.ptm; ong += c.ong; dig += c.digital; cr += num(r.cr); exp += num(r.exp); cashGiven += c.cash; });
  const m = crFor(date);
  const totalCash = round2(cashGiven + num(m.twoTCash) + num(m.custCash));
  const cashDiff = round2(totalCash - (num(m.yDeposit) + num(m.tDeposit)));
  return { date, id: m.id, msL: round2(msL), hsdL: round2(hsdL), totalL: round2(msL + hsdL), gross: round2(gross), testRs: round2(testRs), net: round2(net), bpe: round2(bpe), ppe: round2(ppe), ptm: round2(ptm), ong: round2(ong), dig: round2(dig), cr: round2(cr), exp: round2(exp), cashGiven: round2(cashGiven), twoTCash: num(m.twoTCash), custCash: num(m.custCash), totalCash, yDeposit: num(m.yDeposit), tDeposit: num(m.tDeposit), cashDiff };
}
async function saveCRDaily(date, patch) {
  const cur = S.crDaily.find(r => r.date === date);
  const rec = { date, twoTCash: num(cur ? cur.twoTCash : 0), custCash: num(cur ? cur.custCash : 0), yDeposit: num(cur ? cur.yDeposit : 0), tDeposit: num(cur ? cur.tDeposit : 0), ...patch };
  if (cur) await dbUpdate('crDaily', cur.id, rec); else await dbCreate('crDaily', rec);
}

function oilPrice(name) { const o = S.oils.find(x => x.name === name); return o ? o.price : 0; }
function oilRollup() {
  return S.oils.map(o => {
    const pur = S.oilPurchases.filter(x => x.name === o.name).reduce((a, b) => a + num(b.qty), 0);
    const sold = S.oilSales.filter(x => x.name === o.name).reduce((a, b) => a + num(b.qty), 0);
    const closing = num(o.qty) + pur - sold;
    return { ...o, pur, sold, closing, stockVal: round2(closing * num(o.price)), salesVal: round2(sold * num(o.price)) };
  });
}
function oilSalesRs(f, t) { return round2(S.oilSales.filter(x => (!f || x.date >= f) && (!t || x.date <= t)).reduce((a, b) => a + num(b.qty) * oilPrice(b.name), 0)); }
function oilPurchasesRs(f, t) { return round2(S.oilPurchases.filter(x => (!f || x.date >= f) && (!t || x.date <= t)).reduce((a, b) => a + (num(b.value) || num(b.qty) * oilPrice(b.name)), 0)); }
function creditSummary() {
  return S.customers.map(c => {
    const given = S.credit.filter(x => x.customer === c.name).reduce((a, b) => a + num(b.given), 0);
    const paid = S.credit.filter(x => x.customer === c.name).reduce((a, b) => a + num(b.paid), 0);
    const out = round2(num(c.opening) + given - paid);
    const last = S.credit.filter(x => x.customer === c.name).map(x => x.date).sort().pop() || '';
    return { name: c.name, opening: num(c.opening), given: round2(given), paid: round2(paid), out, limit: num(c.limit), over: c.limit > 0 && out > c.limit, last };
  });
}
const totalOutstanding = () => round2(creditSummary().reduce((a, b) => a + b.out, 0));
function payroll(mk) {
  const att = S.attendance[mk] || {};
  return S.staff.filter(s => s.status !== 'Left').map(s => {
    const rec = att[s.id] || { marks: {}, ot: 0, recovery: 0 };
    const marks = Object.values(rec.marks || {});
    const payDays = marks.filter(m => m === 'P').length + 0.5 * marks.filter(m => m === 'H').length;
    const dayRate = num(s.salary) / (S.payroll.standardDays || 30);
    const earned = round2(dayRate * payDays);
    const otPay = round2(num(rec.ot) * (S.payroll.otRate || 0));
    const gross = round2(earned + otPay);
    const adv = round2(S.advances.filter(a => a.staffId === s.id && monthKey(a.date) === mk).reduce((x, y) => x + num(y.amount), 0));
    const net = round2(gross - adv - num(rec.recovery));
    return { id: s.id, name: s.name, salary: num(s.salary), dayRate: round2(dayRate), payDays, ot: num(rec.ot), otPay, gross, adv, recovery: num(rec.recovery), net };
  });
}
function stockRecon(prod) {
  const rows = S.fuelStock.filter(r => r.product === prod).sort((a, b) => a.date.localeCompare(b.date));
  let prevPhys = null; const out = [];
  for (const r of rows) {
    const opening = (r.openingDip !== '' && r.openingDip != null) ? num(r.openingDip) : (prevPhys != null ? prevPhys : 0);
    const receipts = round2(S.fuelPurchases.filter(p => p.date === r.date && p.product === prod).reduce((a, b) => a + num(b.received), 0));
    const sales = aggSales(salesOnDate(r.date).filter(x => x.prod === prod))[prod === 'MS' ? 'ms' : 'hsd'];
    const book = round2(opening + receipts - sales);
    const phys = (r.physicalDip === '' || r.physicalDip == null) ? null : num(r.physicalDip);
    const varL = phys == null ? null : round2(phys - book);
    const varPct = (varL == null || book === 0) ? null : round2(varL / book * 100);
    prevPhys = phys != null ? phys : book;
    out.push({ ...r, opening: round2(opening), receipts, sales, book, phys, varL, varPct });
  }
  return out;
}
function cashBankRows() {
  const rows = [...S.cashBank].sort((a, b) => a.date.localeCompare(b.date));
  let hand = num(S.settings.openingCash); const out = [];
  for (const r of rows) {
    const fuel = aggSales(salesOnDate(r.date)).net;
    const oil = oilSalesRs(r.date, r.date);
    const totalSales = round2(fuel + oil);
    const creditGiven = round2(S.credit.filter(x => x.date === r.date).reduce((a, b) => a + num(b.given), 0));
    const digital = round2(num(r.bpe) + num(r.ppe) + num(r.gpay) + num(r.ptm) + num(r.ong) + num(r.card));
    const accounted = round2(num(r.cashRecd) + digital + creditGiven + num(r.adj));
    const variance = round2(accounted - totalSales);
    const cashExp = round2(S.expenses.filter(e => e.date === r.date && e.mode === 'Cash').reduce((a, b) => a + num(b.amount), 0));
    hand = round2(hand + num(r.cashRecd) - cashExp - num(r.deposited));
    out.push({ ...r, totalSales, creditGiven, digital, accounted, variance, cashExp, hand });
  }
  return out;
}
function cashInHandNow() { const r = cashBankRows(); return r.length ? r[r.length - 1].hand : num(S.settings.openingCash); }
function complianceRows() {
  const today = new Date(todayISO());
  return S.compliance.map(c => { let d = null, s = ''; if (c.expiry) { d = Math.round((new Date(c.expiry) - today) / 864e5); s = d < 0 ? 'EXPIRED' : d < 30 ? 'DUE SOON' : 'OK'; } return { ...c, daysLeft: d, status: s }; });
}
function statusPill(s) { if (!s) return '—'; const c = s === 'OK' ? 'ok' : s === 'DUE SOON' ? 'due' : 'bad'; return `<span class="pill ${c}">${s}</span>`; }
function last12Months() {
  const out = []; const now = activeMonths().slice(-1)[0] || monthKey(todayISO());
  let [y, m] = now.split('-').map(Number);
  for (let i = 0; i < 12; i++) { out.push(`${y}-${String(m).padStart(2, '0')}`); m--; if (m < 1) { m = 12; y--; } }
  activeMonths().forEach(mk => { if (!out.includes(mk)) out.push(mk); });
  return [...new Set(out)].sort().reverse();
}

/* ============================================================
   NAV
   ============================================================ */
const VIEWS = [
  { grp: 'Overview' },
  { id: 'dashboard', ic: '▦', label: 'Dashboard', sub: 'Live snapshot, monthly P&L and 3-month comparison' },
  { grp: 'Daily operations' },
  { id: 'sales', ic: '⛽', label: 'Daily Sales', sub: 'Pump-boy settlement + daily Consolidated Report' },
  { id: 'shifts', ic: '🕐', label: 'Shifts', sub: 'Open & close shifts, cash handover and variance' },
  { id: 'prices', ic: '₹', label: 'Fuel Prices', sub: 'Effective selling price log (MS / HSD)' },
  { id: 'stock', ic: '🛢', label: 'Fuel Stock & Recon', sub: 'Wet-stock reconciliation (the audit core)' },
  { id: 'purchases', ic: '🚚', label: 'Fuel Purchases', sub: 'Tanker decantation log' },
  { id: 'cash', ic: '💵', label: 'Cash & Bank', sub: 'Daily collections, deposits & cash-in-hand' },
  { grp: 'Ledgers' },
  { id: 'credit', ic: '📒', label: 'Customer Credit', sub: 'Credit given / repayments and outstanding by customer' },
  { id: 'oils', ic: '🧴', label: 'Engine Oils', sub: 'Inventory + daily sales & purchase log' },
  { id: 'expenses', ic: '🧾', label: 'Expenses', sub: 'Daily expense log by category' },
  { id: 'tanker', ic: '🛻', label: 'Tanker Log', sub: 'Freight trips and cost' },
  { grp: 'People & compliance' },
  { id: 'attendance', ic: '🗓', label: 'Attendance & Payroll', sub: 'Mark P/H/L, advances → auto payroll' },
  { id: 'compliance', ic: '🛡', label: 'Compliance', sub: 'Licences, W&M stamping, expiry alerts' },
  { grp: 'Automation' },
  { id: 'alerts', ic: '🔔', label: 'WhatsApp Alerts', sub: 'Auto-send reports & reminders to WhatsApp' },
  { grp: 'Accountability' },
  { id: 'audit', ic: '📜', label: 'Audit Log', sub: 'Who changed what, and when' },
  { grp: 'Configuration' },
  { id: 'setup', ic: '⚙', label: 'Setup / Master Data', sub: 'Station, products, pumps, staff, customers, pumps, users' },
];
let current = 'dashboard';
function buildNav() {
  const nav = $('#nav'); nav.innerHTML = '';
  let pendingGrp = null;
  for (const v of VIEWS) {
    if (v.grp) { pendingGrp = v.grp; continue; }
    if (!canViewArea(AREA_OF_VIEW[v.id])) continue;
    if (pendingGrp) { nav.appendChild(el('div', { class: 'grp' }, pendingGrp)); pendingGrp = null; }
    const b = el('button', { class: v.id === current ? 'active' : '' });
    b.innerHTML = `<span class="ic">${v.ic}</span><span>${v.label}</span>`;
    b.onclick = () => go(v.id); nav.appendChild(b);
  }
}
function go(id) { current = id; buildNav(); render(); window.scrollTo(0, 0); const app = document.querySelector('.app'); if (app) app.classList.remove('nav-open'); }
function render() {
  // if the role can't view the current area, fall back to dashboard
  if (!canViewArea(AREA_OF_VIEW[current])) current = 'dashboard';
  const v = VIEWS.find(x => x.id === current);
  S._area = AREA_OF_VIEW[current];
  $('#viewTitle').textContent = v.label; $('#viewSub').textContent = v.sub || '';
  $('#topActions').innerHTML = '';
  $('#brandName').textContent = (S.user && S.user.firmName) || S.station.name || (S.appName || 'PumpSathi');
  $('#brandSub').textContent = S.appName || 'PumpSathi';
  // banners live in a persistent container the RENDER functions don't clear
  let banner = $('#banner');
  if (!banner) { banner = el('div', { id: 'banner' }); const view = $('#view'); view.parentNode.insertBefore(banner, view); }
  banner.innerHTML = '';
  if (S.user && S.user.sup) banner.appendChild(impersonationBanner());
  if (S._area && !canEditArea(S._area)) banner.appendChild(el('div', { class: 'offline-banner show', style: 'background:rgba(245,165,36,.14);border-color:rgba(245,165,36,.4);color:#ffcf7a' }, '👁 View-only — your role (' + roleLabel(S.user.role) + ') can view this but not edit it.'));
  RENDER[current]();
}
function impersonationBanner() {
  const d = el('div', { class: 'offline-banner show', style: 'background:rgba(61,125,255,.14);border-color:rgba(61,125,255,.45);color:#8fb4ff;display:flex;justify-content:space-between;align-items:center;gap:12px' });
  d.innerHTML = `<span>🛟 Support mode — you are viewing <b>${esc(S.user.firmName || 'another pump')}</b>.</span>`;
  const b = el('button', { class: 'btn sm' }, 'Exit to my pump'); b.onclick = exitImpersonation; d.appendChild(b); return d;
}

/* ============================================================
   UI PRIMITIVES
   ============================================================ */
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2200); }
function topBtn(label, fn, cls = 'primary') { if (!canEditArea(S._area)) return; const b = el('button', { class: 'btn ' + cls }, label); b.onclick = fn; $('#topActions').appendChild(b); }
function subtabs(tabs, active, onChange) { const w = el('div', { class: 'subtabs' }); tabs.forEach(t => { const b = el('button', { class: t === active ? 'active' : '' }, t); b.onclick = () => onChange(t); w.appendChild(b); }); return w; }
function selField(label, options, value, onChange) {
  const f = el('div', { class: 'field' }); f.appendChild(el('label', {}, label));
  const s = el('select'); options.forEach(o => { const v = typeof o === 'object' ? o.v : o, t = typeof o === 'object' ? o.t : o; const op = el('option', { value: v }, t); if (v == value) op.selected = true; s.appendChild(op); });
  s.onchange = () => onChange(s.value); f.appendChild(s); return f;
}
function numField(label, value, onChange) { const f = el('div', { class: 'field' }); f.appendChild(el('label', {}, label)); const i = el('input', { type: 'number', value: value }); i.onchange = () => onChange(i.value); f.appendChild(i); return f; }
function btnField(label, fn) { const f = el('div', { class: 'field' }); f.appendChild(el('label', {}, ' ')); const b = el('button', { class: 'btn' }, label); b.onclick = fn; f.appendChild(b); return f; }
function dateField(label, value, onChange) { const f = el('div', { class: 'field' }); f.appendChild(el('label', {}, label)); const i = el('input', { type: 'date', value: value || '' }); i.onchange = () => onChange(i.value); f.appendChild(i); return f; }
function addMonths(mk, delta) { let [y, m] = mk.split('-').map(Number); m += delta; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return `${y}-${String(m).padStart(2, '0')}`; }
function endOfMonth(mk) { const [y, m] = mk.split('-').map(Number); return new Date(y, m, 0).toISOString().slice(0, 10); }
function bucketsBetween(from, to, gran) {
  if (!from || !to || from > to) { const t = to || from; if (!t) return []; from = to = t; }
  const out = [];
  if (gran === 'day') {
    let d = new Date(from), end = new Date(to), n = 0;
    while (d <= end && n < 120) { const iso = d.toISOString().slice(0, 10); out.push({ from: iso, to: iso, label: iso.slice(5) }); d.setDate(d.getDate() + 1); n++; }
  } else {
    let mk = monthKey(from); const endMk = monthKey(to); let n = 0;
    while (mk <= endMk && n < 60) { out.push({ from: mk + '-01', to: endOfMonth(mk), label: monthLabel(mk) }); mk = addMonths(mk, 1); n++; }
  }
  return out;
}

function table(cols, rows, opts = {}) {
  // hide row actions where the current area is read-only for this role
  if (opts.actions && !canEditArea(S._area)) { opts = { ...opts, onEdit: null, onDelete: null }; }
  const wrap = el('div', { class: 'tbl-wrap' });
  if (!rows.length) { wrap.appendChild(el('div', { class: 'empty' }, opts.empty || 'No records yet. Click “Add” to create one.')); return wrap; }
  const t = el('table'); const thead = el('thead'); const tr = el('tr');
  cols.forEach(c => tr.appendChild(el('th', { class: c.num ? 'num' : '' }, c.label)));
  if (opts.actions) tr.appendChild(el('th', {}, ''));
  thead.appendChild(tr); t.appendChild(thead);
  const tb = el('tbody');
  rows.forEach(r => {
    const row = el('tr');
    cols.forEach(c => { const td = el('td', { class: (c.num ? 'num ' : '') + (c.calc ? 'calc' : '') }); td.innerHTML = c.html ? c.val(r) : esc(c.val(r)); row.appendChild(td); });
    if (opts.actions) {
      const td = el('td'); const w = el('div', { class: 'row-actions' });
      if (opts.onEdit) { const b = el('button', { class: 'icon-btn', title: 'Edit' }, '✎'); b.onclick = () => opts.onEdit(r); w.appendChild(b); }
      if (opts.onDelete) { const b = el('button', { class: 'icon-btn del', title: 'Delete' }, '🗑'); b.onclick = () => opts.onDelete(r); w.appendChild(b); }
      td.appendChild(w); row.appendChild(td);
    }
    tb.appendChild(row);
  });
  t.appendChild(tb);
  if (opts.footer) { const tf = el('tfoot'); const fr = el('tr'); opts.footer.forEach(c => fr.appendChild(el('td', { class: c.num ? 'num' : '' }, c.v == null ? '' : c.v))); if (opts.actions) fr.appendChild(el('td', {}, '')); tf.appendChild(fr); t.appendChild(tf); }
  wrap.appendChild(t); return wrap;
}

/* generic modal form (async save) */
function openForm(title, fields, onSave, wide) {
  $('#modalTitle').textContent = title;
  $('#modalBox').classList.toggle('wide', !!wide);
  const body = $('#modalBody'); body.innerHTML = '';
  const grid = el('div', { class: 'form-grid' });
  fields.forEach(f => {
    if (f.type === 'hr') { grid.appendChild(el('div', { class: 'section-title', style: 'grid-column:1/-1;margin:6px 0 0' }, f.label)); return; }
    const wrap = el('div', { class: 'field' }); if (f.wide) wrap.style.gridColumn = '1/-1';
    wrap.appendChild(el('label', {}, f.label));
    let inp;
    if (f.type === 'select') { inp = el('select'); (f.options || []).forEach(o => { const v = typeof o === 'object' ? o.v : o, t = typeof o === 'object' ? o.t : o; const op = el('option', { value: v }, t); if (v == f.value) op.selected = true; inp.appendChild(op); }); }
    else if (f.type === 'textarea') { inp = el('textarea', { rows: 2 }); inp.value = f.value ?? ''; }
    else { inp = el('input', { type: f.type || 'text' }); if (f.step) inp.step = f.step; inp.value = f.value ?? ''; }
    inp.dataset.key = f.key; if (f.readonly) inp.readOnly = true;
    wrap.appendChild(inp); grid.appendChild(wrap);
  });
  body.appendChild(grid);
  $('#modalSave').onclick = async () => {
    const data = {}; body.querySelectorAll('[data-key]').forEach(i => { data[i.dataset.key] = i.value; });
    $('#modalSave').disabled = true;
    try { const res = await onSave(data); if (res !== false) { closeModal(); render(); } }
    catch (e) { alert('Save failed: ' + e.message); }
    finally { $('#modalSave').disabled = false; }
  };
  $('#modalBack').classList.add('show');
}
function closeModal() { $('#modalBack').classList.remove('show'); $('#modalBox').classList.remove('wide'); $('#modalSave').style.display = ''; }
async function confirmDel(msg, fn) { if (!confirm(msg)) return; try { await fn(); render(); toast('Deleted'); } catch (e) { alert('Delete failed: ' + e.message); } }

/* ============================================================
   CHARTS (dependency-free SVG)
   ============================================================ */
function groupedBarChart(months, series, opts = {}) {
  const W = opts.width || 720, H = opts.height || 300, pad = { l: 64, r: 16, t: 16, b: 40 };
  const cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
  const nice = niceMax(Math.max(1, ...series.flatMap(s => s.data)));
  const gw = months.length ? cw / months.length : cw, bw = Math.min(38, (gw * 0.7) / series.length);
  const svg = [`<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">`];
  for (let i = 0; i <= 4; i++) { const y = pad.t + ch - ch * i / 4; svg.push(`<line class="grid-line" x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}"/><text x="${pad.l - 8}" y="${y + 4}" text-anchor="end">${opts.money ? '₹' + kfmt(nice * i / 4) : kfmt(nice * i / 4)}</text>`); }
  const lab = (mk) => opts.rawLabels ? mk : monthLabel(mk);
  months.forEach((mk, gi) => { const gx = pad.l + gi * gw + gw / 2, tot = bw * series.length; series.forEach((s, si) => { const v = s.data[gi] || 0, bh = ch * v / nice, x = gx - tot / 2 + si * bw, y = pad.t + ch - bh; svg.push(`<rect class="bar" x="${x}" y="${y}" width="${bw - 3}" height="${Math.max(0, bh)}" rx="3" fill="${s.color}"><title>${s.name} · ${lab(mk)}: ${opts.money ? '₹' : ''}${fmt(v)}</title></rect>`); }); svg.push(`<text x="${gx}" y="${H - pad.b + 18}" text-anchor="middle" style="fill:var(--txt)">${lab(mk)}</text>`); });
  svg.push(`<line class="axis" x1="${pad.l}" y1="${pad.t + ch}" x2="${W - pad.r}" y2="${pad.t + ch}"/></svg>`); return svg.join('');
}
function lineChart(labels, series, opts = {}) {
  const W = opts.width || 720, H = opts.height || 260, pad = { l: 60, r: 16, t: 16, b: 36 };
  const cw = W - pad.l - pad.r, ch = H - pad.t - pad.b, nice = niceMax(Math.max(1, ...series.flatMap(s => s.data)));
  const n = labels.length, step = n > 1 ? cw / (n - 1) : 0, X = i => pad.l + i * step, Y = v => pad.t + ch - ch * v / nice;
  const svg = [`<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">`];
  for (let i = 0; i <= 4; i++) { const y = pad.t + ch - ch * i / 4; svg.push(`<line class="grid-line" x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}"/><text x="${pad.l - 8}" y="${y + 4}" text-anchor="end">${opts.money ? '₹' + kfmt(nice * i / 4) : kfmt(nice * i / 4)}</text>`); }
  series.forEach(s => { svg.push(`<polyline fill="none" stroke="${s.color}" stroke-width="2.5" points="${s.data.map((v, i) => `${X(i)},${Y(v)}`).join(' ')}" stroke-linejoin="round"/>`); s.data.forEach((v, i) => svg.push(`<circle cx="${X(i)}" cy="${Y(v)}" r="3.5" fill="${s.color}"><title>${s.name} ${labels[i]}: ${opts.money ? '₹' : ''}${fmt(v)}</title></circle>`)); });
  labels.forEach((l, i) => svg.push(`<text x="${X(i)}" y="${H - pad.b + 18}" text-anchor="middle" style="fill:var(--txt)">${l}</text>`));
  svg.push('</svg>'); return svg.join('');
}
function donut(parts, opts = {}) {
  const size = opts.size || 150, r = size / 2 - 6, cx = size / 2, cy = size / 2, C = 2 * Math.PI * r, total = parts.reduce((a, b) => a + b.v, 0) || 1; let off = 0;
  const svg = [`<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)" stroke-width="14"/>`];
  parts.forEach(p => { const len = C * p.v / total; svg.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${p.color}" stroke-width="14" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 ${cx} ${cy})"><title>${p.name}: ${fmt(p.v)}</title></circle>`); off += len; });
  svg.push(`<text x="${cx}" y="${cy - 2}" text-anchor="middle" style="fill:var(--txt);font-size:15px;font-weight:700">${opts.center || ''}</text><text x="${cx}" y="${cy + 15}" text-anchor="middle" style="font-size:10px">${opts.centerSub || ''}</text></svg>`); return svg.join('');
}
function legend(items) { return `<div class="chart-legend">${items.map(i => `<span><span class="dot" style="background:${i.color}"></span>${i.name}</span>`).join('')}</div>`; }
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10; return m * p; }
function kfmt(v) { if (v >= 1e7) return (v / 1e7).toFixed(1).replace(/\.0$/, '') + 'Cr'; if (v >= 1e5) return (v / 1e5).toFixed(1).replace(/\.0$/, '') + 'L'; if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'; return fmt(v); }

/* ============================================================
   PRINT / PDF REPORTS  (opens a clean print window → Save as PDF)
   ============================================================ */
function topBtnAlways(label, fn, cls = 'ghost') { const b = el('button', { class: 'btn ' + cls }, label); b.onclick = fn; $('#topActions').appendChild(b); }
function ptable(headers, rows, foot) {
  const h = '<tr>' + headers.map(x => `<th class="${x.n ? 'n' : ''}">${esc(x.t)}</th>`).join('') + '</tr>';
  const b = rows.map(r => '<tr>' + r.map((c, i) => `<td class="${headers[i] && headers[i].n ? 'n' : ''}">${esc(c)}</td>`).join('') + '</tr>').join('');
  const f = foot ? `<tfoot><tr>${foot.map((c, i) => `<td class="${headers[i] && headers[i].n ? 'n' : ''}">${esc(c)}</td>`).join('')}</tr></tfoot>` : '';
  return `<table><thead>${h}</thead><tbody>${b}</tbody>${f}</table>`;
}
function openPrintDoc(title, bodyHtml) {
  const s = S.station || {}; const name = (S.user && S.user.firmName) || s.name || 'PumpSathi';
  const bits = [s.address, s.gstin ? 'GSTIN: ' + s.gstin : '', s.omc, s.code ? 'RO: ' + s.code : ''].filter(Boolean).join('  ·  ');
  const w = window.open('', '_blank', 'width=920,height=760');
  if (!w) { alert('Please allow pop-ups for this site to print reports.'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    *{box-sizing:border-box} body{font-family:'Segoe UI',system-ui,Arial,sans-serif;color:#14181f;margin:26px;font-size:13px}
    .rh{border-bottom:2px solid #1a2330;padding-bottom:12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:flex-end;gap:20px}
    .rh .n{font-size:22px;font-weight:800;letter-spacing:-.3px} .rh .b{color:#667085;font-size:11px;margin-top:4px;max-width:520px}
    .rh .t{text-align:right;color:#344054;font-weight:600}
    h2{font-size:14px;margin:18px 0 8px;color:#1a2330}
    table{border-collapse:collapse;width:100%;margin:8px 0 14px;font-size:12px}
    th,td{border:1px solid #d0d5dd;padding:7px 10px;text-align:left} th{background:#f2f4f7;font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#475467}
    td.n,th.n{text-align:right;font-variant-numeric:tabular-nums} tfoot td{font-weight:700;background:#f7f9fb}
    .rf{margin-top:22px;color:#98a2b3;font-size:10.5px;border-top:1px solid #e4e7ec;padding-top:8px}
    .kpis{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 4px}
    .kpis .k{border:1px solid #e4e7ec;border-radius:8px;padding:8px 12px;min-width:130px}
    .kpis .k .l{font-size:10px;color:#667085;text-transform:uppercase} .kpis .k .v{font-size:16px;font-weight:700;margin-top:2px}
    @media print{.noprint{display:none} body{margin:12px}}
  </style></head><body>
    <div class="rh"><div><div class="n">${esc(name)}</div><div class="b">${esc(bits)}</div></div><div class="t">${esc(title)}</div></div>
    ${bodyHtml}
    <div class="rf">Generated by ${esc(S.appName || 'PumpSathi')} · ${new Date().toLocaleString('en-IN')}</div>
    <div class="noprint" style="margin-top:18px;display:flex;gap:8px"><button onclick="window.print()" style="padding:8px 16px;font-size:13px;cursor:pointer">🖨 Print / Save as PDF</button><button onclick="window.close()" style="padding:8px 16px;font-size:13px;cursor:pointer">Close</button></div>
  </body></html>`);
  w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch (e) { } }, 400);
}
function printMonthly(mk) {
  const mStart = mk + '-01', mEnd = new Date(mk.split('-')[0], mk.split('-')[1], 0).toISOString().slice(0, 10);
  const agg = aggSales(salesInMonth(mk));
  const oilS = oilSalesRs(mStart, mEnd), oilP = oilPurchasesRs(mStart, mEnd);
  const msComm = num(S.settings.msCommission), hsdComm = num(S.settings.hsdCommission);
  const msM = round2(agg.ms * msComm), hsdM = round2(agg.hsd * hsdComm), oilM = round2(oilS - oilP);
  const gross = round2(msM + hsdM + oilM);
  const sal = payroll(mk).reduce((a, b) => a + b.gross, 0);
  const oExp = round2(S.expenses.filter(e => e.date >= mStart && e.date <= mEnd).reduce((a, b) => a + num(b.amount), 0));
  const frt = round2(S.tanker.filter(t => t.date >= mStart && t.date <= mEnd).reduce((a, b) => a + num(b.freight), 0));
  const costs = round2(sal + oExp + frt), net = round2(gross - costs);
  const body = `<div class="kpis">
      <div class="k"><div class="l">Total Fuel Sales</div><div class="v">${rupee(agg.net)}</div></div>
      <div class="k"><div class="l">MS / HSD Litres</div><div class="v">${fmt(agg.ms)} / ${fmt(agg.hsd)}</div></div>
      <div class="k"><div class="l">Net Profit</div><div class="v">${rupee(net)}</div></div></div>
    <h2>Profit &amp; Loss — ${monthLabel(mk)}</h2>` + ptable(
    [{ t: 'Line' }, { t: 'Amount ₹', n: true }],
    [['MS Petrol — Sales', fmt(agg.msRs)], ['HSD Diesel — Sales', fmt(agg.hsdRs)], ['Engine Oil — Sales', fmt(oilS)], ['TOTAL SALES', fmt(round2(agg.net + oilS))],
    ['MS Margin (commission)', fmt(msM)], ['HSD Margin (commission)', fmt(hsdM)], ['Oil Margin', fmt(oilM)], ['GROSS MARGIN', fmt(gross)],
    ['Salaries (payroll)', fmt(sal)], ['Other Expenses', fmt(oExp)], ['Freight (tanker)', fmt(frt)], ['TOTAL COSTS', fmt(costs)]],
    ['NET PROFIT', fmt(net)]);
  openPrintDoc('Monthly Report — ' + monthLabel(mk), body);
}
function printCR(mk) {
  const dates = [...new Set(salesInMonth(mk).map(r => r.date))].sort();
  if (!dates.length) { alert('No sales in this month to print.'); return; }
  const H = [{ t: 'Date' }, { t: 'MS L', n: true }, { t: 'HSD L', n: true }, { t: 'Total L', n: true }, { t: 'Gross ₹', n: true }, { t: 'Net Sale ₹', n: true }, { t: 'Digital ₹', n: true }, { t: 'Credit ₹', n: true }, { t: 'Cash ₹', n: true }, { t: 'Deposited ₹', n: true }, { t: 'Cash diff ₹', n: true }];
  const tot = { msL: 0, hsdL: 0, totalL: 0, gross: 0, net: 0, dig: 0, cr: 0, cashGiven: 0, dep: 0, cd: 0 };
  const rows = dates.map(d => { const x = crRow(d); const dep = num(x.yDeposit) + num(x.tDeposit); tot.msL += x.msL; tot.hsdL += x.hsdL; tot.totalL += x.totalL; tot.gross += x.gross; tot.net += x.net; tot.dig += x.dig; tot.cr += x.cr; tot.cashGiven += x.totalCash; tot.dep += dep; tot.cd += x.cashDiff; return [d, fmt(x.msL), fmt(x.hsdL), fmt(x.totalL), fmt(x.gross), fmt(x.net), fmt(x.dig), fmt(x.cr), fmt(x.totalCash), fmt(dep), fmt(x.cashDiff)]; });
  const foot = ['TOTAL', fmt(tot.msL), fmt(tot.hsdL), fmt(tot.totalL), fmt(tot.gross), fmt(tot.net), fmt(tot.dig), fmt(tot.cr), fmt(tot.cashGiven), fmt(tot.dep), fmt(tot.cd)];
  openPrintDoc('Consolidated Report — ' + monthLabel(mk), '<h2>Daily consolidated sales — ' + monthLabel(mk) + '</h2>' + ptable(H, rows, foot));
}
function printStatement() {
  const sum = creditSummary().filter(c => c.out > 0 || c.given || c.paid).sort((a, b) => b.out - a.out);
  const H = [{ t: 'Customer' }, { t: 'Opening ₹', n: true }, { t: 'Credit Given ₹', n: true }, { t: 'Payments ₹', n: true }, { t: 'Outstanding ₹', n: true }, { t: 'Status' }];
  const rows = sum.map(c => [c.name, fmt(c.opening), fmt(c.given), fmt(c.paid), fmt(c.out), c.over ? 'OVER LIMIT' : 'OK']);
  const foot = ['TOTAL', '', '', '', fmt(totalOutstanding()), ''];
  openPrintDoc('Customer Credit Statement', '<h2>Outstanding by customer · as on ' + todayISO() + '</h2>' + ptable(H, rows, foot));
}

/* ============================================================
   RENDERERS
   ============================================================ */
const RENDER = {};
function kpi(label, val, desc, cls = '') { return `<div class="kpi ${cls}"><div class="l">${label}</div><div class="v">${val}</div><div class="d">${desc || ''}</div></div>`; }

/* ---------- Dashboard ---------- */
RENDER.dashboard = function () {
  const v = $('#view'); v.innerHTML = '';
  const months = activeMonths(), complete = completeMonths();
  const defMonth = complete[complete.length - 1] || months[months.length - 1] || monthKey(todayISO());
  const mk = S._dashMonth && months.includes(S._dashMonth) ? S._dashMonth : defMonth;
  topBtnAlways('🖨 Print month report', () => printMonthly(mk));
  const mStart = mk + '-01', mEnd = new Date(mk.split('-')[0], mk.split('-')[1], 0).toISOString().slice(0, 10);
  const agg = aggSales(salesInMonth(mk));
  const oilSalesM = oilSalesRs(mStart, mEnd), oilPurM = oilPurchasesRs(mStart, mEnd);
  const totalSales = round2(agg.net + oilSalesM);
  const msComm = num(S.settings.msCommission), hsdComm = num(S.settings.hsdCommission);
  const msMargin = round2(agg.ms * msComm), hsdMargin = round2(agg.hsd * hsdComm), oilMargin = round2(oilSalesM - oilPurM);
  const grossMargin = round2(msMargin + hsdMargin + oilMargin);
  const salariesM = payroll(mk).reduce((a, b) => a + b.gross, 0);
  const otherExpM = round2(S.expenses.filter(e => e.date >= mStart && e.date <= mEnd).reduce((a, b) => a + num(b.amount), 0));
  const freightM = round2(S.tanker.filter(t => t.date >= mStart && t.date <= mEnd).reduce((a, b) => a + num(b.freight), 0));
  const totalCosts = round2(salariesM + otherExpM + freightM), netProfit = round2(grossMargin - totalCosts);

  const bar = el('div', { class: 'filters' });
  bar.appendChild(selField('Reporting month', (months.length ? months : [mk]).map(m => ({ v: m, t: monthLabel(m) + (complete.includes(m) ? '' : ' (MTD)') })), mk, val => { S._dashMonth = val; render(); }));
  v.appendChild(bar);

  const kp = el('div', { class: 'grid kpis' });
  kp.innerHTML = `
    ${kpi('Total Fuel Sales', rupee(agg.net), monthLabel(mk) + ' month-to-date')}
    ${kpi('MS Petrol', fmt(agg.ms) + ' L', rupee(agg.msRs))}
    ${kpi('HSD Diesel', fmt(agg.hsd) + ' L', rupee(agg.hsdRs))}
    ${kpi('Net Profit (month)', rupee(netProfit), 'after payroll, expenses, freight', netProfit >= 0 ? 'good' : 'bad')}
    ${kpi('Cash in Hand', rupee(cashInHandNow()), 'current position')}
    ${kpi('Credit Outstanding', rupee(totalOutstanding()), creditSummary().filter(c => c.over).length + ' over-limit', totalOutstanding() > 0 ? 'warn' : '')}
    ${kpi('Oil Stock Value', rupee(oilRollup().reduce((a, b) => a + b.stockVal, 0)), 'inventory at price')}
    ${kpi('Staff on Roll', S.staff.filter(s => s.status === 'Active').length, 'active employees')}`;
  v.appendChild(kp);

  /* ---- Today at the pump ---- */
  const dts = [...new Set(S.dailySales.map(r => r.date))].sort();
  const day = S._dashDay || (dts.includes(todayISO()) ? todayISO() : (dts[dts.length - 1] || todayISO()));
  const dRows = salesOnDate(day), dAgg = aggSales(dRows);
  const dCredit = round2(S.credit.filter(x => x.date === day).reduce((a, b) => a + num(b.given), 0));
  const today = el('div', { class: 'card', style: 'margin-top:18px' });
  today.appendChild(el('div', { class: 'card-head', html: `<h3>Today at the pump</h3><span class="tag">${day}</span>` }));
  const dbar = el('div', { class: 'filters' });
  dbar.appendChild(dateField('Day', day, val => { S._dashDay = val; render(); }));
  today.appendChild(dbar);
  today.innerHTML += `<div class="mini">
    <div class="stat"><div class="l">Day fuel sale</div><div class="v">${rupee(dAgg.net)}</div></div>
    <div class="stat"><div class="l">MS / HSD litres</div><div class="v">${fmt(dAgg.ms)} / ${fmt(dAgg.hsd)}</div></div>
    <div class="stat"><div class="l">Cash collected</div><div class="v">${rupee(dAgg.cash)}</div></div>
    <div class="stat"><div class="l">Digital</div><div class="v">${rupee(dAgg.digital)}</div></div>
    <div class="stat"><div class="l">Credit given</div><div class="v">${rupee(dCredit)}</div></div></div>`;
  // low-stock alerts (latest physical dip vs reorder level)
  const reorder = { MS: num(S.settings.reorderMS) || 2000, HSD: num(S.settings.reorderHSD) || 2000 };
  const lowMsgs = [];
  ['MS', 'HSD'].forEach(p => { const rec = stockRecon(p).filter(x => x.phys != null).slice(-1)[0]; if (rec && rec.phys < reorder[p]) lowMsgs.push(`${p === 'MS' ? 'MS Petrol' : 'HSD Diesel'} low: ${fmt(rec.phys)} L (reorder ≤ ${fmt(reorder[p])} L)`); });
  if (lowMsgs.length) today.appendChild(el('div', { class: 'offline-banner show', style: 'margin-top:12px', html: '⚠ ' + lowMsgs.join(' &nbsp;·&nbsp; ') }));
  // nozzle-wise + shift summary
  const nozzleRow = el('div', { class: 'grid two-col', style: 'margin-top:14px' });
  const byPump = {}; dRows.forEach(r => { const c = calcSale(r); const k = r.pump || '—'; (byPump[k] = byPump[k] || { pump: k, prod: r.prod, litres: 0, amt: 0 }); byPump[k].litres += c.netL; byPump[k].amt += c.netAmt; });
  const nz = el('div', { class: 'card' }); nz.innerHTML = `<div class="card-head"><h3>Nozzle-wise sales</h3></div>`;
  nz.appendChild(table([{ label: 'Pump', val: r => r.pump }, { label: 'Fuel', val: r => r.prod }, { label: 'Litres', num: true, val: r => fmt(r.litres, 1) }, { label: 'Sale ₹', num: true, val: r => fmt(r.amt) }], Object.values(byPump).sort((a, b) => b.amt - a.amt), { empty: 'No sales entered for this day.' }));
  nozzleRow.appendChild(nz);
  const shiftsToday = S.shifts.filter(s => s.date === day);
  const sh = el('div', { class: 'card' }); sh.innerHTML = `<div class="card-head"><h3>Shift summary</h3></div>`;
  sh.appendChild(table([{ label: 'Shift', val: r => r.name }, { label: 'Staff', val: r => r.staff || '—' }, { label: 'Closing ₹', num: true, val: r => r.status === 'Closed' ? fmt(r.closingCash) : '—' }, { label: 'Variance', num: true, val: r => r.status === 'Closed' ? `<span class="pill ${Math.abs(shiftVariance(r)) > 100 ? 'due' : 'ok'}">${fmt(shiftVariance(r))}</span>` : '<span class="pill due">Open</span>', html: true }], shiftsToday, { empty: 'No shifts logged for this day.' }));
  nozzleRow.appendChild(sh);
  today.appendChild(nozzleRow);
  v.appendChild(today);

  const dataDates = S.dailySales.map(r => r.date).filter(Boolean).sort();
  const minD = dataDates[0] || (mk + '-01'), maxD = dataDates[dataDates.length - 1] || todayISO();
  const defFrom = months.length >= 3 ? months[months.length - 3] + '-01' : minD;
  const cFrom = S._cmpFrom || defFrom, cTo = S._cmpTo || maxD, gran = S._cmpGran || 'month';
  const buckets = bucketsBetween(cFrom, cTo, gran);
  const bagg = buckets.map(b => aggSales(S.dailySales.filter(r => r.date >= b.from && r.date <= b.to)));
  const cmp = el('div', { class: 'card', style: 'margin-top:18px' });
  cmp.appendChild(el('div', { class: 'card-head', html: `<h3>Comparative Sales</h3><span class="tag">${buckets.length} ${gran === 'day' ? 'day' : 'month'}${buckets.length !== 1 ? 's' : ''}</span>` }));
  cmp.appendChild(el('div', { class: 'hint', html: 'Pick any date range and granularity to compare fuel sales by product.' }));
  const ctr = el('div', { class: 'filters' });
  ctr.appendChild(dateField('From', cFrom, val => { S._cmpFrom = val; render(); }));
  ctr.appendChild(dateField('To', cTo, val => { S._cmpTo = val; render(); }));
  ctr.appendChild(selField('Granularity', [{ v: 'month', t: 'Monthly' }, { v: 'day', t: 'Daily' }], gran, val => { S._cmpGran = val; render(); }));
  const quick = el('div', { class: 'field' }); quick.appendChild(el('label', {}, 'Quick range'));
  const qwrap = el('div', { style: 'display:flex;gap:6px' });
  [['3M', 3], ['6M', 6], ['12M', 12]].forEach(([lbl, n]) => { const b = el('button', { class: 'btn sm' }, lbl); b.onclick = () => { S._cmpGran = 'month'; S._cmpTo = maxD; S._cmpFrom = addMonths(monthKey(maxD), -(n - 1)) + '-01'; render(); }; qwrap.appendChild(b); });
  quick.appendChild(qwrap); ctr.appendChild(quick);
  cmp.appendChild(ctr);
  if (!buckets.length || !S.dailySales.length) cmp.appendChild(el('div', { class: 'empty' }, 'No sales in the selected range yet. Add rows in Daily Sales.'));
  else {
    cmp.innerHTML += groupedBarChart(buckets.map(b => b.label), [
      { name: 'MS Petrol ₹', color: 'var(--ms)', data: bagg.map(x => x.msRs) },
      { name: 'HSD Diesel ₹', color: 'var(--hsd)', data: bagg.map(x => x.hsdRs) },
      { name: 'Total Fuel ₹', color: 'var(--accent)', data: bagg.map(x => x.net) },
    ], { money: true, height: 300, rawLabels: true, width: Math.max(720, buckets.length * 90) });
    cmp.innerHTML += legend([{ name: 'MS Petrol', color: 'var(--ms)' }, { name: 'HSD Diesel', color: 'var(--hsd)' }, { name: 'Total Fuel', color: 'var(--accent)' }]);
    const totNet = round2(bagg.reduce((a, b) => a + b.net, 0)), totL = round2(bagg.reduce((a, b) => a + b.ms + b.hsd, 0));
    let bi = 0; bagg.forEach((x, i) => { if (x.net > bagg[bi].net) bi = i; });
    const mini = el('div', { class: 'mini', style: 'margin-top:14px' });
    mini.innerHTML = `<div class="stat"><div class="l">Range total fuel sales</div><div class="v">${rupee(totNet)}</div></div><div class="stat"><div class="l">Range total litres</div><div class="v">${fmt(totL)} L</div></div><div class="stat"><div class="l">Best ${gran === 'day' ? 'day' : 'month'}</div><div class="v">${buckets[bi] ? buckets[bi].label : '—'}</div></div>`;
    cmp.appendChild(mini);
  }
  v.appendChild(cmp);

  if (months.length > 1) {
    const trend = el('div', { class: 'card', style: 'margin-top:16px' });
    trend.appendChild(el('div', { class: 'card-head', html: `<h3>Fuel sales trend — all months</h3>` }));
    const allAgg = months.map(m => aggSales(salesInMonth(m)));
    trend.innerHTML += lineChart(months.map(monthLabel), [{ name: 'MS ₹', color: 'var(--ms)', data: allAgg.map(x => x.msRs) }, { name: 'HSD ₹', color: 'var(--hsd)', data: allAgg.map(x => x.hsdRs) }], { money: true, height: 240 });
    trend.innerHTML += legend([{ name: 'MS Petrol', color: 'var(--ms)' }, { name: 'HSD Diesel', color: 'var(--hsd)' }]);
    v.appendChild(trend);
  }

  const row = el('div', { class: 'grid two-col', style: 'margin-top:16px' });
  const pl = el('div', { class: 'card' });
  pl.innerHTML = `<div class="card-head"><h3>Monthly P&amp;L — ${monthLabel(mk)}</h3></div>`;
  pl.appendChild(table([{ label: 'Line', val: r => r.k }, { label: 'Amount ₹', num: true, val: r => r.v, calc: true }], [
    { k: 'MS Petrol — Sales', v: fmt(agg.msRs) }, { k: 'HSD Diesel — Sales', v: fmt(agg.hsdRs) }, { k: 'Engine Oil — Sales', v: fmt(oilSalesM) }, { k: 'TOTAL SALES', v: fmt(totalSales) },
    { k: 'MS Margin (comm.)', v: fmt(msMargin) }, { k: 'HSD Margin (comm.)', v: fmt(hsdMargin) }, { k: 'Oil Margin', v: fmt(oilMargin) }, { k: 'GROSS MARGIN', v: fmt(grossMargin) },
    { k: 'Salaries (payroll)', v: fmt(salariesM) }, { k: 'Other Expenses', v: fmt(otherExpM) }, { k: 'Freight (tanker)', v: fmt(freightM) }, { k: 'TOTAL COSTS', v: fmt(totalCosts) }, { k: 'NET PROFIT', v: fmt(netProfit) },
  ]));
  row.appendChild(pl);
  const mix = el('div', { class: 'card' }); mix.innerHTML = `<div class="card-head"><h3>Product mix (litres)</h3></div>`;
  const tot = agg.ms + agg.hsd;
  mix.innerHTML += `<div style="display:flex;justify-content:center">${donut([{ name: 'MS Petrol', v: agg.ms, color: 'var(--ms)' }, { name: 'HSD Diesel', v: agg.hsd, color: 'var(--hsd)' }], { center: fmt(tot), centerSub: 'litres', size: 170 })}</div>`;
  mix.innerHTML += legend([{ name: 'MS ' + (tot ? Math.round(agg.ms / tot * 100) : 0) + '%', color: 'var(--ms)' }, { name: 'HSD ' + (tot ? Math.round(agg.hsd / tot * 100) : 0) + '%', color: 'var(--hsd)' }]);
  mix.innerHTML += `<div class="mini" style="margin-top:16px"><div class="stat"><div class="l">Digital collections</div><div class="v">${rupee(agg.digital)}</div></div><div class="stat"><div class="l">Credit given</div><div class="v">${rupee(agg.cr)}</div></div></div>`;
  row.appendChild(mix); v.appendChild(row);

  const row2 = el('div', { class: 'grid two-col', style: 'margin-top:16px' });
  const top = el('div', { class: 'card' }); top.innerHTML = `<div class="card-head"><h3>Top outstanding customers</h3></div>`;
  top.appendChild(table([{ label: 'Customer', val: r => r.name }, { label: 'Outstanding ₹', num: true, val: r => fmt(r.out) }, { label: '', val: r => r.over ? '<span class="pill over">OVER</span>' : '<span class="pill ok">OK</span>', html: true }], creditSummary().filter(c => c.out > 0).sort((a, b) => b.out - a.out).slice(0, 6), { empty: 'No outstanding credit.' }));
  row2.appendChild(top);
  const comp = el('div', { class: 'card' }); comp.innerHTML = `<div class="card-head"><h3>Compliance alerts</h3></div>`;
  comp.appendChild(table([{ label: 'Licence', val: r => r.item }, { label: 'Expiry', val: r => r.expiry }, { label: 'Status', val: r => statusPill(r.status), html: true }], complianceRows().filter(c => c.expiry).sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9)), { empty: 'Add expiry dates in Compliance to see alerts.' }));
  row2.appendChild(comp); v.appendChild(row2);
};

/* ---------- Daily Sales + Consolidated Report ---------- */
RENDER.sales = function () {
  const tab = S._salesTab || 'Entries';
  if (tab === 'Entries') topBtn('+ Add sale', () => editSale());
  const v = $('#view'); v.innerHTML = '';
  v.appendChild(subtabs(['Entries', 'Consolidated Report'], tab, t => { S._salesTab = t; render(); }));
  const months = activeMonths();
  const mk = S._salesMonth && months.includes(S._salesMonth) ? S._salesMonth : (months[months.length - 1] || '');
  if (tab === 'Consolidated Report' && mk) topBtnAlways('🖨 Print CR', () => printCR(mk));
  const bar = el('div', { class: 'filters' });
  bar.appendChild(selField('Month', months.length ? months.map(m => ({ v: m, t: monthLabel(m) })) : [{ v: '', t: '— no data —' }], mk, val => { S._salesMonth = val; render(); }));
  if (tab === 'Entries') {
    const dates = [...new Set(salesInMonth(mk).map(r => r.date))].sort();
    bar.appendChild(selField('Day', [{ v: 'all', t: 'All days' }, ...dates.map(d => ({ v: d, t: d }))], S._salesDate && dates.includes(S._salesDate) ? S._salesDate : 'all', val => { S._salesDate = val; render(); }));
  }
  v.appendChild(bar);
  if (tab === 'Entries') renderSalesEntries(mk); else renderCR(mk);
};
function renderSalesEntries(mk) {
  const v = $('#view');
  let rows = salesInMonth(mk);
  const dsel = S._salesDate || 'all';
  if (dsel !== 'all') rows = rows.filter(r => r.date === dsel);
  rows = rows.sort((a, b) => a.date.localeCompare(b.date) || String(a.pump).localeCompare(String(b.pump)));
  const agg = aggSales(rows);
  const mini = el('div', { class: 'mini', style: 'margin-bottom:14px' });
  mini.innerHTML = `<div class="stat"><div class="l">MS litres</div><div class="v">${fmt(agg.ms)}</div></div><div class="stat"><div class="l">HSD litres</div><div class="v">${fmt(agg.hsd)}</div></div><div class="stat"><div class="l">Net sale</div><div class="v">${rupee(agg.net)}</div></div><div class="stat"><div class="l">Digital</div><div class="v">${rupee(agg.digital)}</div></div><div class="stat"><div class="l">Credit</div><div class="v">${rupee(agg.cr)}</div></div><div class="stat"><div class="l">Cash given</div><div class="v">${rupee(agg.cash)}</div></div>`;
  v.appendChild(mini);
  const C = calcSale;
  v.appendChild(table([
    { label: 'Date', val: r => r.date }, { label: 'P.Boy NAME', val: r => r.boy }, { label: 'PUMP', val: r => r.pump },
    { label: 'MS/HS', val: r => `<span class="pill ${r.prod === 'MS' ? 'ms' : 'hsd'}">${r.prod}</span>`, html: true },
    { label: 'Opening', num: true, val: r => fmt(r.open, 2) }, { label: 'Closing', num: true, val: r => fmt(r.close, 2) },
    { label: 'Difference', num: true, calc: true, val: r => fmt(C(r).diff, 2) }, { label: 'Rate', num: true, calc: true, val: r => fmt(C(r).rate, 2) },
    { label: 'Amount', num: true, calc: true, val: r => fmt(C(r).amount) }, { label: 'Testing Qty', num: true, val: r => fmt(r.test, 2) },
    { label: 'Testing Amt', num: true, calc: true, val: r => fmt(C(r).testAmt) },
    { label: 'B.Pe 1', num: true, val: r => fmt(r.bpe1) }, { label: 'B.Pe 2', num: true, val: r => fmt(r.bpe2) },
    { label: 'Phone Pe', num: true, val: r => fmt(r.phonepe) }, { label: 'B.Phone Pe 1', num: true, val: r => fmt(r.bphonepe1) }, { label: 'B.Phone Pe 2', num: true, val: r => fmt(r.bphonepe2) },
    { label: 'PAYTM 1', num: true, val: r => fmt(r.paytm1) }, { label: 'PAYTM 2', num: true, val: r => fmt(r.paytm2) },
    { label: 'ONGO 1', num: true, val: r => fmt(r.ongo1) }, { label: 'ONGO 2', num: true, val: r => fmt(r.ongo2) },
    { label: 'Total Digital', num: true, calc: true, val: r => fmt(C(r).digital) }, { label: 'Total Credits', num: true, val: r => fmt(r.cr) },
    { label: 'Other Exp', num: true, val: r => fmt(r.exp) }, { label: 'Cash Given', num: true, calc: true, val: r => fmt(C(r).cash) },
  ], rows, { actions: true, onEdit: editSale, onDelete: r => confirmDel('Delete this sale row?', () => dbDelete('dailySales', r.id)) }));
}
function editSale(r) {
  const boys = S.staff.map(s => s.name), pumps = S.nozzles.map(n => n.dispenser + ' ' + n.nozzle);
  const g = k => r ? (r[k] ?? 0) : 0;
  const opt = (arr, val) => arr.map(o => `<option ${o == val ? 'selected' : ''}>${esc(o)}</option>`).join('');
  $('#modalTitle').textContent = r ? 'Edit daily sale' : 'Add daily sale';
  $('#modalBox').classList.add('wide');
  $('#modalBody').innerHTML = `
    <div class="form-grid">
      <div class="field"><label>Date</label><input type="date" data-k="date" value="${r ? r.date : todayISO()}"></div>
      <div class="field"><label>P.Boy NAME</label><select data-k="boy">${opt(boys, r ? r.boy : boys[0])}</select></div>
      <div class="field"><label>PUMP</label><select data-k="pump">${opt(pumps, r ? r.pump : (pumps[0] || ''))}</select></div>
      <div class="field"><label>MS/HS</label><select data-k="prod">${opt(['MS', 'HSD'], r ? r.prod : 'MS')}</select></div>
      <div class="field"><label>Opening Reading</label><input type="number" step="0.01" data-k="open" value="${r ? r.open : ''}"></div>
      <div class="field"><label>Closing Reading</label><input type="number" step="0.01" data-k="close" value="${r ? r.close : ''}"></div>
      <div class="field"><label>Testing Qty</label><input type="number" step="0.01" data-k="test" value="${g('test')}"></div>
    </div>
    <div class="section-title">Collections (₹)</div>
    <div class="form-grid">
      <div class="field"><label>B.Pe 1</label><input type="number" data-k="bpe1" value="${g('bpe1')}"></div>
      <div class="field"><label>B.Pe 2</label><input type="number" data-k="bpe2" value="${g('bpe2')}"></div>
      <div class="field"><label>Phone Pe</label><input type="number" data-k="phonepe" value="${g('phonepe')}"></div>
      <div class="field"><label>B.Phone Pe 1</label><input type="number" data-k="bphonepe1" value="${g('bphonepe1')}"></div>
      <div class="field"><label>B.Phone Pe 2</label><input type="number" data-k="bphonepe2" value="${g('bphonepe2')}"></div>
      <div class="field"><label>PAYTM 1</label><input type="number" data-k="paytm1" value="${g('paytm1')}"></div>
      <div class="field"><label>PAYTM 2</label><input type="number" data-k="paytm2" value="${g('paytm2')}"></div>
      <div class="field"><label>ONGO Swiping 1</label><input type="number" data-k="ongo1" value="${g('ongo1')}"></div>
      <div class="field"><label>ONGO Swiping 2</label><input type="number" data-k="ongo2" value="${g('ongo2')}"></div>
      <div class="field"><label>TOTAL CREDITS</label><input type="number" data-k="cr" value="${g('cr')}"></div>
      <div class="field"><label>Other Expenses Total</label><input type="number" data-k="exp" value="${g('exp')}"></div>
    </div>
    <div class="computed-grid" id="saleCalc"></div>`;
  const collect = () => { const o = {}; $('#modalBody').querySelectorAll('[data-k]').forEach(i => o[i.dataset.k] = i.value); return { date: o.date, boy: o.boy, pump: o.pump, prod: o.prod, open: num(o.open), close: num(o.close), test: num(o.test), bpe1: num(o.bpe1), bpe2: num(o.bpe2), phonepe: num(o.phonepe), bphonepe1: num(o.bphonepe1), bphonepe2: num(o.bphonepe2), paytm1: num(o.paytm1), paytm2: num(o.paytm2), ongo1: num(o.ongo1), ongo2: num(o.ongo2), cr: num(o.cr), exp: num(o.exp) }; };
  const recompute = () => { const c = calcSale(collect()); $('#saleCalc').innerHTML = `
    <div class="c"><div class="l">Difference Reading</div><div class="v">${fmt(c.diff, 2)}</div></div>
    <div class="c"><div class="l">MS/HS Rate</div><div class="v">${fmt(c.rate, 2)}</div></div>
    <div class="c"><div class="l">Amount ₹</div><div class="v">${fmt(c.amount)}</div></div>
    <div class="c"><div class="l">Testing Amount ₹</div><div class="v">${fmt(c.testAmt)}</div></div>
    <div class="c"><div class="l">Total Digital ₹</div><div class="v">${fmt(c.digital)}</div></div>
    <div class="c"><div class="l">Net Litres</div><div class="v">${fmt(c.netL, 2)}</div></div>
    <div class="c"><div class="l">Net Amount ₹</div><div class="v">${fmt(c.netAmt)}</div></div>
    <div class="c cash"><div class="l">Cash Given ₹</div><div class="v">${fmt(c.cash)}</div></div>`; };
  $('#modalBody').querySelectorAll('[data-k]').forEach(i => i.addEventListener('input', recompute));
  recompute();
  $('#modalSave').onclick = async () => { const rec = collect(); $('#modalSave').disabled = true; try { if (r) await dbUpdate('dailySales', r.id, rec); else await dbCreate('dailySales', rec); closeModal(); render(); toast('Saved'); } catch (e) { alert('Save failed: ' + e.message); } finally { $('#modalSave').disabled = false; } };
  $('#modalBack').classList.add('show');
}
function renderCR(mk) {
  const v = $('#view');
  const dates = [...new Set(salesInMonth(mk).map(r => r.date))].sort();
  v.appendChild(el('div', { class: 'hint', style: 'margin-bottom:12px', html: 'One auto row per day. White cells (2T+AWB+EO Cash, Customer Cash Received, Yesterday/Today Deposited) are manual — everything else cumulates from the entries.' }));
  if (!dates.length) { v.appendChild(el('div', { class: 'empty' }, 'No sales in this month yet.')); return; }
  const wrap = el('div', { class: 'tbl-wrap' });
  const t = el('table'); const heads = ['Date', 'MS Litres', 'HSD Litres', 'Total Litres', 'Gross Amount ₹', 'Testing ₹', 'Net Sale ₹', 'B.Pe ₹', 'Phone Pe ₹', 'PAYTM ₹', 'ONGO ₹', 'Total Digital ₹', 'Total Credits ₹', 'Other Exp ₹', '2T+AWB+EO Cash ₹', 'Customer Cash Received ₹', 'Total Cash ₹', 'Yesterday Deposited ₹', 'Today Deposited ₹', 'Cash diff. ₹'];
  const thead = el('thead'); const htr = el('tr'); heads.forEach((h, i) => htr.appendChild(el('th', { class: i ? 'num' : '' }, h))); thead.appendChild(htr); t.appendChild(thead);
  const tb = el('tbody');
  const tot = { msL: 0, hsdL: 0, totalL: 0, gross: 0, testRs: 0, net: 0, bpe: 0, ppe: 0, ptm: 0, ong: 0, dig: 0, cr: 0, exp: 0, twoTCash: 0, custCash: 0, totalCash: 0, yDeposit: 0, tDeposit: 0, cashDiff: 0 };
  dates.forEach(d => {
    const x = crRow(d); Object.keys(tot).forEach(k => tot[k] += num(x[k]));
    const tr = el('tr');
    const cell = (val, cls = 'num') => tr.appendChild(el('td', { class: cls }, val));
    cell(d, ''); cell(fmt(x.msL)); cell(fmt(x.hsdL)); cell(fmt(x.totalL));
    tr.appendChild(el('td', { class: 'num calc' }, fmt(x.gross))); tr.appendChild(el('td', { class: 'num' }, fmt(x.testRs)));
    tr.appendChild(el('td', { class: 'num calc' }, fmt(x.net)));
    cell(fmt(x.bpe)); cell(fmt(x.ppe)); cell(fmt(x.ptm)); cell(fmt(x.ong));
    tr.appendChild(el('td', { class: 'num calc' }, fmt(x.dig))); cell(fmt(x.cr)); cell(fmt(x.exp));
    // manual inputs
    const mkInput = (field, value) => { const td = el('td', { class: 'num' }); const inp = el('input', { type: 'number', class: 'mini-inp', value: value }); inp.onchange = async () => { try { await saveCRDaily(d, { [field]: num(inp.value) }); render(); } catch (e) { alert(e.message); } }; td.appendChild(inp); tr.appendChild(td); };
    mkInput('twoTCash', x.twoTCash); mkInput('custCash', x.custCash);
    tr.appendChild(el('td', { class: 'num calc' }, fmt(x.totalCash)));
    mkInput('yDeposit', x.yDeposit); mkInput('tDeposit', x.tDeposit);
    tr.appendChild(el('td', { class: 'num', html: `<span class="pill ${Math.abs(x.cashDiff) > 100 ? 'due' : 'ok'}">${fmt(x.cashDiff)}</span>` }));
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  const tf = el('tfoot'); const ftr = el('tr');
  const fcells = ['TOTAL', fmt(tot.msL), fmt(tot.hsdL), fmt(tot.totalL), fmt(tot.gross), fmt(tot.testRs), fmt(tot.net), fmt(tot.bpe), fmt(tot.ppe), fmt(tot.ptm), fmt(tot.ong), fmt(tot.dig), fmt(tot.cr), fmt(tot.exp), fmt(tot.twoTCash), fmt(tot.custCash), fmt(tot.totalCash), fmt(tot.yDeposit), fmt(tot.tDeposit), fmt(tot.cashDiff)];
  fcells.forEach((c, i) => ftr.appendChild(el('td', { class: i ? 'num' : '' }, c))); tf.appendChild(ftr); t.appendChild(tf);
  wrap.appendChild(t); v.appendChild(wrap);
}

/* ---------- Fuel Prices ---------- */
RENDER.prices = function () {
  topBtn('+ Add price', () => editPrice());
  const v = $('#view'); v.innerHTML = '';
  v.appendChild(el('div', { class: 'card', style: 'margin-bottom:16px', html: `<div class="hint">Add a row only when the selling price changes. Daily Sales auto-fills the rate by the latest effective date (falls back to the product price in Setup).</div>` }));
  v.appendChild(table([{ label: 'Effective date', val: r => r.date }, { label: 'MS ₹/L', num: true, val: r => fmt(r.ms, 2) }, { label: 'HSD ₹/L', num: true, val: r => fmt(r.hsd, 2) }],
    [...S.priceLog].sort((a, b) => b.date.localeCompare(a.date)), { actions: true, onEdit: editPrice, onDelete: r => confirmDel('Delete this price row?', () => dbDelete('priceLog', r.id)) }));
};
function editPrice(r) {
  openForm(r ? 'Edit price' : 'Add price', [
    { key: 'date', label: 'Effective date', type: 'date', value: r ? r.date : todayISO() },
    { key: 'ms', label: 'MS Petrol ₹/L', type: 'number', step: '0.01', value: r ? r.ms : '' },
    { key: 'hsd', label: 'HSD Diesel ₹/L', type: 'number', step: '0.01', value: r ? r.hsd : '' },
  ], async d => { const rec = { date: d.date, ms: num(d.ms), hsd: num(d.hsd) }; if (r) await dbUpdate('priceLog', r.id, rec); else await dbCreate('priceLog', rec); toast('Saved'); });
}

/* ---------- Customer Credit ---------- */
RENDER.credit = function () {
  topBtn('+ Add entry', () => editCredit());
  if ((S._creditTab || 'Ledger') === 'Summary') topBtnAlways('🖨 Print statement', () => printStatement());
  const v = $('#view'); v.innerHTML = '';
  v.appendChild(subtabs(['Ledger', 'Summary'], S._creditTab || 'Ledger', t => { S._creditTab = t; render(); }));
  if ((S._creditTab || 'Ledger') === 'Ledger') {
    v.appendChild(table([
      { label: 'Date', val: r => r.date }, { label: 'Customer', val: r => r.customer }, { label: 'Particulars', val: r => r.particulars },
      { label: 'Credit Given ₹', num: true, val: r => fmt(r.given) }, { label: 'Payment ₹', num: true, val: r => fmt(r.paid) }, { label: 'Mode', val: r => r.mode },
    ], [...S.credit].sort((a, b) => b.date.localeCompare(a.date)), { actions: true, onEdit: editCredit, onDelete: r => confirmDel('Delete entry?', () => dbDelete('credit', r.id)) }));
  } else {
    const sum = creditSummary().filter(c => c.given || c.paid || c.opening || c.out);
    v.appendChild(el('div', { class: 'mini', style: 'margin-bottom:14px', html: `<div class="stat"><div class="l">Total outstanding</div><div class="v">${rupee(totalOutstanding())}</div></div><div class="stat"><div class="l">With balance</div><div class="v">${sum.filter(c => c.out > 0).length}</div></div><div class="stat"><div class="l">Over limit</div><div class="v" style="color:var(--danger)">${sum.filter(c => c.over).length}</div></div>` }));
    v.appendChild(table([
      { label: 'Customer', val: r => r.name }, { label: 'Opening ₹', num: true, val: r => fmt(r.opening) }, { label: 'Credit Given ₹', num: true, val: r => fmt(r.given) },
      { label: 'Payments ₹', num: true, val: r => fmt(r.paid) }, { label: 'Outstanding ₹', num: true, calc: true, val: r => fmt(r.out) }, { label: 'Limit ₹', num: true, val: r => r.limit ? fmt(r.limit) : '—' },
      { label: 'Status', val: r => r.over ? '<span class="pill over">OVER</span>' : '<span class="pill ok">OK</span>', html: true }, { label: 'Last txn', val: r => r.last || '—' },
    ], sum.sort((a, b) => b.out - a.out)));
  }
};
function editCredit(r) {
  const custs = S.customers.map(c => c.name);
  openForm(r ? 'Edit credit entry' : 'Add credit entry', [
    { key: 'date', label: 'Date', type: 'date', value: r ? r.date : todayISO() },
    { key: 'customer', label: 'Customer', type: 'select', options: custs, value: r ? r.customer : custs[0] },
    { key: 'particulars', label: 'Particulars', type: 'text', value: r ? r.particulars : '', wide: true },
    { key: 'given', label: 'Credit given ₹', type: 'number', value: r ? r.given : 0 },
    { key: 'paid', label: 'Payment received ₹', type: 'number', value: r ? r.paid : 0 },
    { key: 'mode', label: 'Mode', type: 'select', options: ['', 'Cash', 'UPI', 'Bank', 'Cheque'], value: r ? r.mode : '' },
  ], async d => { const rec = { date: d.date, customer: d.customer, particulars: d.particulars, given: num(d.given), paid: num(d.paid), mode: d.mode }; if (r) await dbUpdate('credit', r.id, rec); else await dbCreate('credit', rec); toast('Saved'); });
}

/* ---------- Engine Oils ---------- */
RENDER.oils = function () {
  const tab = S._oilTab || 'Inventory';
  if (tab === 'Inventory') topBtn('+ Add product', () => editOil());
  else if (tab === 'Sales') topBtn('+ Log sale', () => editOilTxn('oilSales'));
  else topBtn('+ Log purchase', () => editOilTxn('oilPurchases'));
  const v = $('#view'); v.innerHTML = '';
  v.appendChild(subtabs(['Inventory', 'Sales', 'Purchases'], tab, t => { S._oilTab = t; render(); }));
  if (tab === 'Inventory') {
    const roll = oilRollup();
    v.appendChild(el('div', { class: 'mini', style: 'margin-bottom:14px', html: `<div class="stat"><div class="l">Products</div><div class="v">${roll.length}</div></div><div class="stat"><div class="l">Stock value</div><div class="v">${rupee(roll.reduce((a, b) => a + b.stockVal, 0))}</div></div><div class="stat"><div class="l">Sales value</div><div class="v">${rupee(roll.reduce((a, b) => a + b.salesVal, 0))}</div></div>` }));
    v.appendChild(table([
      { label: 'Product', val: r => r.name }, { label: 'Price ₹', num: true, val: r => fmt(r.price) }, { label: 'Opening Qty', num: true, val: r => fmt(r.qty) },
      { label: 'Purchases', num: true, val: r => fmt(r.pur) }, { label: 'Sales', num: true, val: r => fmt(r.sold) }, { label: 'Closing', num: true, calc: true, val: r => fmt(r.closing) }, { label: 'Stock ₹', num: true, calc: true, val: r => fmt(r.stockVal) },
    ], roll, { actions: true, onEdit: editOil, onDelete: r => confirmDel('Delete product?', () => dbDelete('oils', r.id)) }));
  } else {
    const coll = tab === 'Sales' ? 'oilSales' : 'oilPurchases';
    v.appendChild(table([
      { label: 'Date', val: r => r.date }, { label: 'Product', val: r => r.name }, { label: 'Qty', num: true, val: r => fmt(r.qty) }, { label: 'Value ₹', num: true, calc: true, val: r => fmt(r.value || num(r.qty) * oilPrice(r.name)) },
    ], [...S[coll]].sort((a, b) => b.date.localeCompare(a.date)), { actions: true, onEdit: rr => editOilTxn(coll, rr), onDelete: rr => confirmDel('Delete entry?', () => dbDelete(coll, rr.id)) }));
  }
};
function editOil(r) {
  openForm(r ? 'Edit oil product' : 'Add oil product', [
    { key: 'name', label: 'Product name', type: 'text', value: r ? r.name : '', wide: true }, { key: 'price', label: 'Price ₹', type: 'number', value: r ? r.price : 0 }, { key: 'qty', label: 'Opening qty', type: 'number', value: r ? r.qty : 0 },
  ], async d => { const rec = { name: d.name, price: num(d.price), qty: num(d.qty) }; if (r) await dbUpdate('oils', r.id, rec); else await dbCreate('oils', rec); toast('Saved'); });
}
function editOilTxn(coll, r) {
  const names = S.oils.map(o => o.name);
  openForm(r ? 'Edit entry' : (coll === 'oilSales' ? 'Log oil sale' : 'Log oil purchase'), [
    { key: 'date', label: 'Date', type: 'date', value: r ? r.date : todayISO() }, { key: 'name', label: 'Product', type: 'select', options: names, value: r ? r.name : names[0] }, { key: 'qty', label: 'Quantity', type: 'number', value: r ? r.qty : 1 },
  ], async d => { const rec = { date: d.date, name: d.name, qty: num(d.qty), value: round2(num(d.qty) * oilPrice(d.name)) }; if (r) await dbUpdate(coll, r.id, rec); else await dbCreate(coll, rec); toast('Saved'); });
}

/* ---------- Attendance & Payroll ---------- */
RENDER.attendance = function () {
  const v = $('#view'); v.innerHTML = '';
  const months = last12Months();
  const mk = S._attMonth || monthKey(activeMonths().slice(-1)[0] || todayISO());
  const bar = el('div', { class: 'filters' });
  bar.appendChild(selField('Month', months.map(m => ({ v: m, t: monthLabel(m) })), mk, val => { S._attMonth = val; render(); }));
  bar.appendChild(btnField('+ Advance', () => editAdvance()));
  v.appendChild(bar);
  const tab = S._attTab || 'Attendance';
  v.appendChild(subtabs(['Attendance', 'Payroll', 'Advances'], tab, t => { S._attTab = t; render(); }));
  const days = new Date(mk.split('-')[0], mk.split('-')[1], 0).getDate();
  S.attendance[mk] = S.attendance[mk] || {};
  if (tab === 'Attendance') {
    v.appendChild(el('div', { class: 'hint', style: 'margin-bottom:10px', html: 'Click a cell to cycle blank → P → H → L. Payable days = P + ½·H.' }));
    const wrap = el('div', { class: 'tbl-wrap' }); const t = el('table'); const thead = el('thead'); const tr = el('tr');
    tr.appendChild(el('th', {}, 'Staff')); for (let d = 1; d <= days; d++) tr.appendChild(el('th', { class: 'num' }, d)); tr.appendChild(el('th', { class: 'num' }, 'Pay days')); tr.appendChild(el('th', { class: 'num' }, 'OT hrs'));
    thead.appendChild(tr); t.appendChild(thead); const tb = el('tbody');
    S.staff.filter(s => s.status !== 'Left').forEach(s => {
      const rec = S.attendance[mk][s.id] = S.attendance[mk][s.id] || { marks: {}, ot: 0, recovery: 0 };
      const row = el('tr'); row.appendChild(el('td', {}, esc(s.name)));
      for (let d = 1; d <= days; d++) {
        const td = el('td', { class: 'num', style: 'cursor:pointer;user-select:none' }); const m = rec.marks[d] || '';
        td.textContent = m || '·'; td.style.color = m === 'P' ? 'var(--ok)' : m === 'H' ? 'var(--warn)' : m === 'L' ? 'var(--danger)' : 'var(--dim)'; td.style.fontWeight = m ? '700' : '400';
        td.onclick = async () => { const seq = ['', 'P', 'H', 'L']; const ni = (seq.indexOf(m) + 1) % 4; if (seq[ni]) rec.marks[d] = seq[ni]; else delete rec.marks[d]; try { await saveKV('attendance'); } catch (e) { } render(); };
        row.appendChild(td);
      }
      const pd = Object.values(rec.marks).filter(x => x === 'P').length + 0.5 * Object.values(rec.marks).filter(x => x === 'H').length;
      row.appendChild(el('td', { class: 'num calc' }, pd));
      const otTd = el('td', { class: 'num' }); const otIn = el('input', { type: 'number', class: 'mini-inp', value: rec.ot || 0 }); otIn.onchange = async () => { rec.ot = num(otIn.value); try { await saveKV('attendance'); toast('Saved'); } catch (e) { } }; otTd.appendChild(otIn); row.appendChild(otTd);
      tb.appendChild(row);
    });
    t.appendChild(tb); wrap.appendChild(t); v.appendChild(wrap);
  } else if (tab === 'Payroll') {
    const pr = payroll(mk);
    v.appendChild(el('div', { class: 'mini', style: 'margin-bottom:14px', html: `<div class="stat"><div class="l">Gross payroll</div><div class="v">${rupee(pr.reduce((a, b) => a + b.gross, 0))}</div></div><div class="stat"><div class="l">Advances</div><div class="v">${rupee(pr.reduce((a, b) => a + b.adv, 0))}</div></div><div class="stat"><div class="l">Net payable</div><div class="v">${rupee(pr.reduce((a, b) => a + b.net, 0))}</div></div>` }));
    v.appendChild(table([
      { label: 'Staff', val: r => r.name }, { label: 'Salary', num: true, val: r => fmt(r.salary) }, { label: 'Day rate', num: true, val: r => fmt(r.dayRate, 2) }, { label: 'Pay days', num: true, val: r => r.payDays },
      { label: 'OT hrs', num: true, val: r => r.ot }, { label: 'OT pay', num: true, val: r => fmt(r.otPay) }, { label: 'Gross', num: true, calc: true, val: r => fmt(r.gross) }, { label: 'Advance', num: true, val: r => fmt(r.adv) }, { label: 'Net payable', num: true, calc: true, val: r => fmt(r.net) },
    ], pr));
  } else {
    v.appendChild(table([
      { label: 'Date', val: r => r.date }, { label: 'Staff', val: r => (S.staff.find(s => s.id === r.staffId) || {}).name || '?' }, { label: 'Amount ₹', num: true, val: r => fmt(r.amount) },
    ], S.advances.filter(a => monthKey(a.date) === mk).sort((a, b) => b.date.localeCompare(a.date)), { actions: true, onEdit: editAdvance, onDelete: r => confirmDel('Delete advance?', () => dbDelete('advances', r.id)) }));
  }
};
function editAdvance(r) {
  const staff = S.staff.map(s => ({ v: s.id, t: s.name }));
  openForm(r ? 'Edit advance' : 'Add advance', [
    { key: 'date', label: 'Date', type: 'date', value: r ? r.date : todayISO() }, { key: 'staffId', label: 'Staff', type: 'select', options: staff, value: r ? r.staffId : staff[0] && staff[0].v }, { key: 'amount', label: 'Amount ₹', type: 'number', value: r ? r.amount : 0 },
  ], async d => { const rec = { date: d.date, staffId: d.staffId, amount: num(d.amount) }; if (r) await dbUpdate('advances', r.id, rec); else await dbCreate('advances', rec); toast('Saved'); });
}

/* ---------- Fuel Stock & Recon ---------- */
RENDER.stock = function () {
  topBtn('+ Add dip', () => editStock());
  const v = $('#view'); v.innerHTML = '';
  v.appendChild(el('div', { class: 'hint', style: 'margin-bottom:12px', html: 'Book Closing = Opening + Receipts − Sales (auto). Variance = Physical − Book. Investigate beyond ±0.5–1%.' }));
  ['MS', 'HSD'].forEach(prod => {
    const rows = stockRecon(prod).sort((a, b) => b.date.localeCompare(a.date));
    const card = el('div', { class: 'card', style: 'margin-bottom:16px' }); card.innerHTML = `<div class="card-head"><h3>${prod === 'MS' ? 'MS Petrol' : 'HSD Diesel'} tank</h3></div>`;
    card.appendChild(table([
      { label: 'Date', val: r => r.date }, { label: 'Opening', num: true, val: r => fmt(r.opening) }, { label: 'Receipts', num: true, val: r => fmt(r.receipts) }, { label: 'Sales', num: true, val: r => fmt(r.sales) },
      { label: 'Book close', num: true, calc: true, val: r => fmt(r.book) }, { label: 'Physical', num: true, val: r => r.phys == null ? '—' : fmt(r.phys) }, { label: 'Var (L)', num: true, val: r => r.varL == null ? '—' : fmt(r.varL, 1) },
      { label: 'Var %', num: true, val: r => r.varPct == null ? '—' : `<span class="pill ${Math.abs(r.varPct) > 1 ? 'bad' : 'ok'}">${fmt(r.varPct, 2)}%</span>`, html: true }, { label: 'Remarks', val: r => r.remarks || '' },
    ], rows, { actions: true, onEdit: editStock, onDelete: r => confirmDel('Delete dip row?', () => dbDelete('fuelStock', r.id)) }));
    v.appendChild(card);
  });
};
function editStock(r) {
  openForm(r ? 'Edit stock dip' : 'Add stock dip', [
    { key: 'date', label: 'Date', type: 'date', value: r ? r.date : todayISO() }, { key: 'product', label: 'Product', type: 'select', options: ['MS', 'HSD'], value: r ? r.product : 'MS' },
    { key: 'openingDip', label: 'Opening dip (L) — blank = prev physical', type: 'number', value: r ? r.openingDip : '' }, { key: 'physicalDip', label: 'Physical dip (L)', type: 'number', value: r ? r.physicalDip : '' }, { key: 'remarks', label: 'Remarks', type: 'text', value: r ? r.remarks : '', wide: true },
  ], async d => { const rec = { date: d.date, product: d.product, openingDip: d.openingDip === '' ? '' : num(d.openingDip), physicalDip: d.physicalDip === '' ? '' : num(d.physicalDip), remarks: d.remarks }; if (r) await dbUpdate('fuelStock', r.id, rec); else await dbCreate('fuelStock', rec); toast('Saved'); });
}

/* ---------- Fuel Purchases ---------- */
RENDER.purchases = function () {
  topBtn('+ Add receipt', () => editPurchase());
  const v = $('#view'); v.innerHTML = '';
  v.appendChild(table([
    { label: 'Date', val: r => r.date }, { label: 'Invoice', val: r => r.invoiceNo }, { label: 'Product', val: r => r.product }, { label: 'Inv qty (L)', num: true, val: r => fmt(r.invoiceQty) }, { label: 'Rate', num: true, val: r => fmt(r.rate, 2) },
    { label: 'Value ₹', num: true, calc: true, val: r => fmt(num(r.invoiceQty) * num(r.rate)) }, { label: 'Received (L)', num: true, calc: true, val: r => fmt(r.received) },
    { label: 'Shortage', num: true, val: r => { const sh = round2(num(r.invoiceQty) - num(r.received)); return `<span class="pill ${sh > 5 ? 'bad' : 'ok'}">${fmt(sh, 1)}</span>`; }, html: true }, { label: 'Density', num: true, val: r => r.density || '—' }, { label: 'Temp°C', num: true, val: r => r.temp || '—' },
  ], [...S.fuelPurchases].sort((a, b) => b.date.localeCompare(a.date)), { actions: true, onEdit: editPurchase, onDelete: r => confirmDel('Delete receipt?', () => dbDelete('fuelPurchases', r.id)) }));
};
function editPurchase(r) {
  openForm(r ? 'Edit fuel receipt' : 'Add fuel receipt', [
    { key: 'date', label: 'Date', type: 'date', value: r ? r.date : todayISO() }, { key: 'invoiceNo', label: 'Invoice No', type: 'text', value: r ? r.invoiceNo : '' }, { key: 'product', label: 'Product', type: 'select', options: ['MS', 'HSD'], value: r ? r.product : 'HSD' },
    { key: 'invoiceQty', label: 'Invoice qty (L)', type: 'number', value: r ? r.invoiceQty : 0 }, { key: 'rate', label: 'Rate ₹/L', type: 'number', step: '0.01', value: r ? r.rate : 0 },
    { key: 'dipBefore', label: 'Dip before (L)', type: 'number', value: r ? r.dipBefore : '' }, { key: 'dipAfter', label: 'Dip after (L)', type: 'number', value: r ? r.dipAfter : '' },
    { key: 'density', label: 'Density', type: 'number', step: '0.0001', value: r ? r.density : '' }, { key: 'temp', label: 'Temp °C', type: 'number', value: r ? r.temp : '' }, { key: 'remarks', label: 'Remarks', type: 'text', value: r ? r.remarks : '', wide: true },
  ], async d => { const received = (d.dipAfter !== '' && d.dipBefore !== '') ? round2(num(d.dipAfter) - num(d.dipBefore)) : num(d.invoiceQty); const rec = { date: d.date, invoiceNo: d.invoiceNo, product: d.product, invoiceQty: num(d.invoiceQty), rate: num(d.rate), dipBefore: d.dipBefore === '' ? '' : num(d.dipBefore), dipAfter: d.dipAfter === '' ? '' : num(d.dipAfter), received, density: d.density === '' ? '' : num(d.density), temp: d.temp === '' ? '' : num(d.temp), remarks: d.remarks }; if (r) await dbUpdate('fuelPurchases', r.id, rec); else await dbCreate('fuelPurchases', rec); toast('Saved'); });
}

/* ---------- Expenses ---------- */
RENDER.expenses = function () {
  topBtn('+ Add expense', () => editExpense());
  const v = $('#view'); v.innerHTML = '';
  const months = last12Months();
  const bar = el('div', { class: 'filters' }); bar.appendChild(selField('Month', [{ v: 'all', t: 'All' }, ...months.map(m => ({ v: m, t: monthLabel(m) }))], S._expMonth || 'all', val => { S._expMonth = val; render(); })); v.appendChild(bar);
  let rows = [...S.expenses]; if ((S._expMonth || 'all') !== 'all') rows = rows.filter(e => monthKey(e.date) === S._expMonth); rows.sort((a, b) => b.date.localeCompare(a.date));
  v.appendChild(el('div', { class: 'mini', style: 'margin-bottom:14px', html: `<div class="stat"><div class="l">Total</div><div class="v">${rupee(rows.reduce((a, b) => a + num(b.amount), 0))}</div></div><div class="stat"><div class="l">Entries</div><div class="v">${rows.length}</div></div>` }));
  v.appendChild(table([
    { label: 'Date', val: r => r.date }, { label: 'Category', val: r => r.category }, { label: 'Description', val: r => r.description }, { label: 'Amount ₹', num: true, val: r => fmt(r.amount) }, { label: 'Mode', val: r => r.mode }, { label: 'Paid to', val: r => r.paidTo },
  ], rows, { actions: true, onEdit: editExpense, onDelete: r => confirmDel('Delete expense?', () => dbDelete('expenses', r.id)) }));
};
function editExpense(r) {
  openForm(r ? 'Edit expense' : 'Add expense', [
    { key: 'date', label: 'Date', type: 'date', value: r ? r.date : todayISO() }, { key: 'category', label: 'Category', type: 'select', options: S.expenseCategories, value: r ? r.category : S.expenseCategories[0] }, { key: 'description', label: 'Description', type: 'text', value: r ? r.description : '', wide: true },
    { key: 'amount', label: 'Amount ₹', type: 'number', value: r ? r.amount : 0 }, { key: 'mode', label: 'Mode', type: 'select', options: ['Cash', 'Bank', 'UPI'], value: r ? r.mode : 'Cash' }, { key: 'paidTo', label: 'Paid to', type: 'text', value: r ? r.paidTo : '' },
  ], async d => { const rec = { date: d.date, category: d.category, description: d.description, amount: num(d.amount), mode: d.mode, paidTo: d.paidTo }; if (r) await dbUpdate('expenses', r.id, rec); else await dbCreate('expenses', rec); toast('Saved'); });
}

/* ---------- Tanker Log ---------- */
RENDER.tanker = function () {
  topBtn('+ Add trip', () => editTanker());
  const v = $('#view'); v.innerHTML = '';
  v.appendChild(table([
    { label: 'Date', val: r => r.date }, { label: 'Depot', val: r => r.depot }, { label: 'Product', val: r => r.product }, { label: 'Qty (L)', num: true, val: r => fmt(r.qty) }, { label: 'Freight ₹', num: true, val: r => fmt(r.freight, 2) }, { label: 'Vehicle', val: r => r.vehicle }, { label: 'Remarks', val: r => r.remarks },
  ], [...S.tanker].sort((a, b) => b.date.localeCompare(a.date)), { actions: true, onEdit: editTanker, onDelete: r => confirmDel('Delete trip?', () => dbDelete('tanker', r.id)) }));
};
function editTanker(r) {
  openForm(r ? 'Edit tanker trip' : 'Add tanker trip', [
    { key: 'date', label: 'Date', type: 'date', value: r ? r.date : todayISO() }, { key: 'depot', label: 'Depot', type: 'text', value: r ? r.depot : '' }, { key: 'product', label: 'Product', type: 'select', options: ['MS', 'HSD'], value: r ? r.product : 'HSD' },
    { key: 'qty', label: 'Qty (L)', type: 'number', value: r ? r.qty : 0 }, { key: 'freight', label: 'Freight ₹', type: 'number', step: '0.01', value: r ? r.freight : 0 }, { key: 'vehicle', label: 'Vehicle No', type: 'text', value: r ? r.vehicle : '' }, { key: 'remarks', label: 'Remarks', type: 'text', value: r ? r.remarks : '', wide: true },
  ], async d => { const rec = { date: d.date, depot: d.depot, product: d.product, qty: num(d.qty), freight: num(d.freight), vehicle: d.vehicle, remarks: d.remarks }; if (r) await dbUpdate('tanker', r.id, rec); else await dbCreate('tanker', rec); toast('Saved'); });
}

/* ---------- Cash & Bank ---------- */
RENDER.cash = function () {
  topBtn('+ Add day', () => editCash());
  const v = $('#view'); v.innerHTML = '';
  const bar = el('div', { class: 'filters' }); bar.appendChild(numField('Opening cash in hand ₹', S.settings.openingCash, async val => { S.settings.openingCash = num(val); try { await saveKV('settings'); } catch (e) { } render(); })); v.appendChild(bar);
  v.appendChild(table([
    { label: 'Date', val: r => r.date }, { label: 'Total Sales', num: true, calc: true, val: r => fmt(r.totalSales) }, { label: 'Cash Recd', num: true, val: r => fmt(r.cashRecd) }, { label: 'Digital', num: true, val: r => fmt(r.digital) },
    { label: 'Credit', num: true, val: r => fmt(r.creditGiven) }, { label: 'Accounted', num: true, calc: true, val: r => fmt(r.accounted) }, { label: 'Variance', num: true, val: r => `<span class="pill ${Math.abs(r.variance) > 100 ? 'due' : 'ok'}">${fmt(r.variance)}</span>`, html: true },
    { label: 'Cash Exp', num: true, val: r => fmt(r.cashExp) }, { label: 'Deposited', num: true, val: r => fmt(r.deposited) }, { label: 'Cash in Hand', num: true, calc: true, val: r => fmt(r.hand) },
  ], cashBankRows().sort((a, b) => b.date.localeCompare(a.date)), { actions: true, onEdit: editCash, onDelete: r => confirmDel('Delete day?', () => dbDelete('cashBank', r.id)) }));
};
function editCash(r) {
  openForm(r ? 'Edit cash & bank day' : 'Add cash & bank day', [
    { key: 'date', label: 'Date', type: 'date', value: r ? r.date : todayISO() }, { key: 'cashRecd', label: 'Cash received ₹', type: 'number', value: r ? r.cashRecd : 0 },
    { type: 'hr', label: 'Digital / card (₹)' },
    { key: 'bpe', label: 'BharatPe', type: 'number', value: r ? r.bpe : 0 }, { key: 'ppe', label: 'PhonePe', type: 'number', value: r ? r.ppe : 0 }, { key: 'gpay', label: 'GPay', type: 'number', value: r ? r.gpay : 0 }, { key: 'ptm', label: 'Paytm', type: 'number', value: r ? r.ptm : 0 }, { key: 'ong', label: 'ONGO Swiping', type: 'number', value: r ? r.ong : 0 }, { key: 'card', label: 'Card / POS', type: 'number', value: r ? r.card : 0 },
    { type: 'hr', label: 'Other' },
    { key: 'adj', label: 'Testing / Adj ₹', type: 'number', value: r ? r.adj : 0 }, { key: 'deposited', label: 'Deposited to bank ₹', type: 'number', value: r ? r.deposited : 0 },
  ], async d => { const rec = { date: d.date, cashRecd: num(d.cashRecd), bpe: num(d.bpe), ppe: num(d.ppe), gpay: num(d.gpay), ptm: num(d.ptm), ong: num(d.ong), card: num(d.card), adj: num(d.adj), deposited: num(d.deposited) }; if (r) await dbUpdate('cashBank', r.id, rec); else await dbCreate('cashBank', rec); toast('Saved'); });
}

/* ---------- Compliance ---------- */
RENDER.compliance = function () {
  topBtn('+ Add licence', () => editCompliance());
  const v = $('#view'); v.innerHTML = '';
  v.appendChild(table([
    { label: 'Licence / Item', val: r => r.item }, { label: 'Authority', val: r => r.authority }, { label: 'Number', val: r => r.number }, { label: 'Issue', val: r => r.issue || '—' }, { label: 'Expiry', val: r => r.expiry || '—' },
    { label: 'Days left', num: true, val: r => r.daysLeft == null ? '—' : r.daysLeft }, { label: 'Status', val: r => statusPill(r.status), html: true },
  ], complianceRows(), { actions: true, onEdit: editCompliance, onDelete: r => confirmDel('Delete item?', () => dbDelete('compliance', r.id)) }));
};
function editCompliance(r) {
  openForm(r ? 'Edit compliance item' : 'Add compliance item', [
    { key: 'item', label: 'Licence / Item', type: 'text', value: r ? r.item : '', wide: true }, { key: 'authority', label: 'Authority', type: 'text', value: r ? r.authority : '' }, { key: 'number', label: 'Number', type: 'text', value: r ? r.number : '' }, { key: 'issue', label: 'Issue date', type: 'date', value: r ? r.issue : '' }, { key: 'expiry', label: 'Expiry date', type: 'date', value: r ? r.expiry : '' },
  ], async d => { const rec = { item: d.item, authority: d.authority, number: d.number, issue: d.issue, expiry: d.expiry }; if (r) await dbUpdate('compliance', r.id, rec); else await dbCreate('compliance', rec); toast('Saved'); });
}

/* ---------- Shifts ---------- */
function shiftVariance(r) { return round2(num(r.closingCash) - (num(r.openingCash) + num(r.cashSales))); }
RENDER.shifts = function () {
  topBtn('+ Open shift', () => editShift());
  const v = $('#view'); v.innerHTML = '';
  v.appendChild(el('div', { class: 'hint', style: 'margin-bottom:12px', html: 'Open a shift with the cash float, then close it with the counted cash. Variance = Closing − (Opening + Cash sales).' }));
  const rows = [...S.shifts].sort((a, b) => (b.date + (b.openTime || '')).localeCompare(a.date + (a.openTime || '')));
  v.appendChild(table([
    { label: 'Date', val: r => r.date }, { label: 'Shift', val: r => r.name }, { label: 'Staff', val: r => r.staff || '—' },
    { label: 'Open', val: r => r.openTime || '—' }, { label: 'Close', val: r => r.closeTime || '—' },
    { label: 'Opening ₹', num: true, val: r => fmt(r.openingCash) }, { label: 'Cash sales ₹', num: true, val: r => fmt(r.cashSales) }, { label: 'Closing ₹', num: true, val: r => fmt(r.closingCash) },
    { label: 'Variance ₹', num: true, calc: true, val: r => r.status === 'Closed' ? `<span class="pill ${Math.abs(shiftVariance(r)) > 100 ? 'due' : 'ok'}">${fmt(shiftVariance(r))}</span>` : '—', html: true },
    { label: 'Status', val: r => `<span class="pill ${r.status === 'Closed' ? 'ok' : 'due'}">${r.status || 'Open'}</span>`, html: true },
  ], rows, { actions: true, onEdit: editShift, onDelete: r => confirmDel('Delete this shift?', () => dbDelete('shifts', r.id)) }));
};
function editShift(r) {
  const staff = S.staff.map(s => s.name);
  const now = new Date().toTimeString().slice(0, 5);
  openForm(r ? 'Edit / close shift' : 'Open shift', [
    { key: 'date', label: 'Date', type: 'date', value: r ? r.date : todayISO() },
    { key: 'name', label: 'Shift', type: 'select', options: ['Morning', 'Evening', 'Night'], value: r ? r.name : 'Morning' },
    { key: 'staff', label: 'In charge', type: 'select', options: staff, value: r ? r.staff : staff[0] },
    { key: 'openTime', label: 'Open time', type: 'time', value: r ? r.openTime : now },
    { key: 'openingCash', label: 'Opening cash float ₹', type: 'number', value: r ? r.openingCash : 0 },
    { type: 'hr', label: 'Close (fill when shift ends)' },
    { key: 'cashSales', label: 'Cash sales during shift ₹', type: 'number', value: r ? r.cashSales : 0 },
    { key: 'closeTime', label: 'Close time', type: 'time', value: r ? r.closeTime : '' },
    { key: 'closingCash', label: 'Counted closing cash ₹', type: 'number', value: r ? r.closingCash : '' },
    { key: 'notes', label: 'Notes', type: 'text', value: r ? r.notes : '', wide: true },
  ], async d => {
    const status = (d.closeTime || d.closingCash !== '') ? 'Closed' : 'Open';
    const rec = { date: d.date, name: d.name, staff: d.staff, openTime: d.openTime, closeTime: d.closeTime, openingCash: num(d.openingCash), cashSales: num(d.cashSales), closingCash: d.closingCash === '' ? '' : num(d.closingCash), notes: d.notes, status };
    if (r) await dbUpdate('shifts', r.id, rec); else await dbCreate('shifts', rec); toast('Saved');
  });
}

/* ---------- Audit Log ---------- */
RENDER.audit = function () {
  const v = $('#view'); v.innerHTML = '';
  v.appendChild(el('div', { class: 'hint', style: 'margin-bottom:12px', html: 'Every create / edit / delete, user &amp; pump change, backup restore and data clear is recorded here.' }));
  const box = el('div', {}, '<div class="hint">Loading…</div>'); v.appendChild(box);
  API.audit().then(rows => {
    box.innerHTML = '';
    box.appendChild(table([
      { label: 'When', val: r => new Date(r.ts).toLocaleString('en-IN') },
      { label: 'Who', val: r => r.actor || '—' },
      { label: 'Action', val: r => r.action },
      { label: 'Area', val: r => r.area || '—' },
    ], rows, { empty: 'No activity recorded yet.' }));
  }).catch(e => { box.innerHTML = ''; box.appendChild(el('div', { class: 'empty' }, e.message)); });
};

async function exitImpersonation() {
  const home = localStorage.getItem('afs_home_token');
  if (home) { API.token = home; localStorage.setItem('afs_token', home); localStorage.removeItem('afs_home_token'); }
  S._setupTab = 'Pumps'; current = 'setup'; await boot();
}

/* ---------- WhatsApp Alerts ---------- */
async function saveAlerts() { try { await saveKV('alerts'); } catch (e) { alert(e.message); } }
RENDER.alerts = function () {
  const v = $('#view'); v.innerHTML = '';
  const a = S.alerts;
  // delivery status
  const status = el('div', { class: 'card', style: 'margin-bottom:16px' });
  status.innerHTML = `<div class="card-head"><h3>WhatsApp delivery</h3>${S.waConfigured ? '<span class="pill ok">LIVE</span>' : '<span class="pill due">PREVIEW MODE</span>'}</div>
    <div class="hint">${S.waConfigured ? 'Connected to WhatsApp — enabled alerts are delivered automatically on schedule.' : 'No WhatsApp credentials yet, so alerts run in <b>preview / dry-run</b> mode (composed &amp; logged, not sent). Add your Meta WhatsApp Cloud API keys (WA_TOKEN, WA_PHONE_ID) on the server to go live — everything else is ready.'}</div>`;
  const masterRow = el('label', { class: 'toggle-row', style: 'margin-top:12px' });
  masterRow.innerHTML = `<input type="checkbox" ${a.enabled ? 'checked' : ''}><span>Enable automatic alerts for this firm</span>`;
  masterRow.querySelector('input').onchange = async e => { a.enabled = e.target.checked; await saveAlerts(); render(); };
  status.appendChild(masterRow);
  v.appendChild(status);

  // alert types
  const typesCard = el('div', { class: 'card', style: 'margin-bottom:16px' });
  typesCard.innerHTML = `<div class="card-head"><h3>Alert types</h3></div><div class="hint">Toggle what to send and to fine-tune each. Use “Preview / send test” to see the exact message (and deliver it now to active recipients).</div>`;
  const defs = [
    { key: 'dailySales', title: '🧾 Daily sales summary', desc: 'End-of-day settlement: litres, sales, digital, credit, cash.', ctrl: t => timeCtrl(t, 'time', '21:30') },
    { key: 'compliance', title: '🛡 Compliance reminders', desc: 'Licences expiring soon or already expired.', ctrl: t => numCtrl(t, 'daysAhead', 30, 'days ahead') },
    { key: 'outstandingCredit', title: '📒 Outstanding credit', desc: 'Debtors with balance above the threshold.', ctrl: t => numCtrl(t, 'threshold', 0, '₹ threshold') },
    { key: 'weeklyAttendance', title: '🗓 Weekly attendance', desc: 'Per-staff P/H/L for the last 7 days.', ctrl: t => weekdayCtrl(t) },
  ];
  const wrap = el('div', { class: 'alert-types' });
  defs.forEach(d => {
    const t = a.types[d.key] = a.types[d.key] || { on: true };
    const row = el('div', { class: 'alert-type' });
    const left = el('div', { class: 'at-main' });
    const tog = el('label', { class: 'toggle-row' }); tog.innerHTML = `<input type="checkbox" ${t.on ? 'checked' : ''}><span><b>${d.title}</b><br><span class="at-desc">${d.desc}</span></span>`;
    tog.querySelector('input').onchange = async e => { t.on = e.target.checked; await saveAlerts(); render(); };
    left.appendChild(tog); row.appendChild(left);
    const right = el('div', { class: 'at-ctrl' }); right.appendChild(d.ctrl(t)); const test = el('button', { class: 'btn sm' }, '✉ Preview / send test'); test.onclick = () => sendAlertTest(d.key); right.appendChild(test); row.appendChild(right);
    wrap.appendChild(row);
  });
  typesCard.appendChild(wrap); v.appendChild(typesCard);

  // recipients
  const rc = el('div', { class: 'card', style: 'margin-bottom:16px' });
  rc.innerHTML = `<div class="card-head"><h3>Recipients</h3></div><div class="hint">WhatsApp numbers that receive the alerts. Add as many as you like; toggle any on/off. Indian numbers can be entered as 10 digits.</div>`;
  const addBtn = el('button', { class: 'btn sm primary', style: 'margin-bottom:12px' }, '+ Add number'); addBtn.onclick = () => editRecipient(); rc.appendChild(addBtn);
  if (!a.recipients.length) rc.appendChild(el('div', { class: 'empty' }, 'No recipients yet. Add a WhatsApp number to start receiving alerts.'));
  else {
    const t = el('table'); t.innerHTML = '<thead><tr><th>Name</th><th>WhatsApp number</th><th>Active</th><th></th></tr></thead>';
    const tb = el('tbody');
    a.recipients.forEach((r, i) => {
      const tr = el('tr');
      tr.appendChild(el('td', {}, esc(r.name || '—')));
      tr.appendChild(el('td', {}, esc(r.number || '')));
      const at = el('td'); const cb = el('input', { type: 'checkbox' }); cb.checked = r.active !== false; cb.onchange = async () => { r.active = cb.checked; await saveAlerts(); }; at.appendChild(cb); tr.appendChild(at);
      const ac = el('td'); const acw = el('div', { class: 'row-actions' });
      const e1 = el('button', { class: 'icon-btn' }, '✎'); e1.onclick = () => editRecipient(i); acw.appendChild(e1);
      const e2 = el('button', { class: 'icon-btn del' }, '🗑'); e2.onclick = async () => { if (confirm('Remove this recipient?')) { a.recipients.splice(i, 1); await saveAlerts(); render(); } }; acw.appendChild(e2);
      ac.appendChild(acw); tr.appendChild(ac); tb.appendChild(tr);
    });
    t.appendChild(tb); const w = el('div', { class: 'tbl-wrap' }); w.appendChild(t); rc.appendChild(w);
  }
  v.appendChild(rc);

  // recent activity
  const rec = el('div', { class: 'card' }); rec.innerHTML = `<div class="card-head"><h3>Recent activity</h3><button class="btn sm ghost" id="refreshRecent">↻ Refresh</button></div><div id="recentBody" class="hint">Loading…</div>`;
  v.appendChild(rec);
  const loadRecent = async () => { try { const r = await API.alertRecent(); const b = $('#recentBody'); if (!r.recent.length) { b.innerHTML = 'No alerts sent yet.'; return; } b.innerHTML = ''; const t = el('table'); t.innerHTML = '<thead><tr><th>Time</th><th>Type</th><th>To</th><th>Result</th></tr></thead>'; const tb = el('tbody'); r.recent.forEach(x => { const tr = el('tr'); tr.appendChild(el('td', {}, new Date(x.ts).toLocaleString('en-IN'))); tr.appendChild(el('td', {}, x.kind || '')); tr.appendChild(el('td', {}, x.to || '')); tr.appendChild(el('td', { html: x.error ? `<span class="pill bad">${esc(x.error)}</span>` : x.dryRun ? '<span class="pill due">preview</span>' : '<span class="pill ok">sent</span>' })); tb.appendChild(tr); }); t.appendChild(tb); const w = el('div', { class: 'tbl-wrap' }); w.appendChild(t); b.innerHTML = ''; b.appendChild(w); } catch (e) { $('#recentBody').textContent = e.message; } };
  $('#refreshRecent').onclick = loadRecent; loadRecent();
};
function timeCtrl(t, key, def) { const w = el('div', { class: 'field mini-field' }); w.appendChild(el('label', {}, 'Send at')); const i = el('input', { type: 'time', value: t[key] || def }); i.onchange = async () => { t[key] = i.value; await saveAlerts(); }; w.appendChild(i); return w; }
function numCtrl(t, key, def, label) { const w = el('div', { class: 'field mini-field' }); w.appendChild(el('label', {}, label)); const i = el('input', { type: 'number', value: t[key] == null ? def : t[key] }); i.onchange = async () => { t[key] = num(i.value); await saveAlerts(); }; w.appendChild(i); return w; }
function weekdayCtrl(t) { const days = [['Sun', 0], ['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6]]; const w = el('div', { class: 'field mini-field' }); w.appendChild(el('label', {}, 'Every')); const s = el('select'); days.forEach(([lbl, val]) => { const o = el('option', { value: val }, lbl); if (val == (t.weekday ?? 1)) o.selected = true; s.appendChild(o); }); s.onchange = async () => { t.weekday = num(s.value); await saveAlerts(); }; w.appendChild(s); return w; }
function editRecipient(i) {
  const r = i == null ? null : S.alerts.recipients[i];
  openForm(r ? 'Edit recipient' : 'Add recipient', [
    { key: 'name', label: 'Name (optional)', type: 'text', value: r ? r.name : '' },
    { key: 'number', label: 'WhatsApp number', type: 'tel', value: r ? r.number : '' },
    { key: 'active', label: 'Active', type: 'select', options: [{ v: 'yes', t: 'Yes' }, { v: 'no', t: 'No' }], value: r ? (r.active === false ? 'no' : 'yes') : 'yes' },
  ], async d => {
    if (!d.number.trim()) { alert('Enter a WhatsApp number'); return false; }
    const rec = { name: d.name.trim(), number: d.number.trim(), active: d.active !== 'no' };
    if (r) S.alerts.recipients[i] = rec; else S.alerts.recipients.push(rec);
    await saveAlerts(); toast('Saved');
  });
}
async function sendAlertTest(type) {
  try {
    const r = await API.alertTest(type);
    $('#modalTitle').textContent = 'Message preview'; $('#modalBox').classList.remove('wide');
    const status = r.configured ? (r.sent ? `Sent to ${r.sent} recipient(s).` : 'No active recipients — add a number above.') : (r.sent ? `Preview mode: composed for ${r.sent} recipient(s) (not delivered — add WhatsApp keys to send).` : 'Preview mode. Add recipients + WhatsApp keys to deliver.');
    $('#modalBody').innerHTML = `<div class="hint" style="margin-bottom:10px">${esc(status)}</div><pre class="wa-preview">${esc(r.preview || '(nothing to report)')}</pre>`;
    $('#modalSave').style.display = 'none';
    $('#modalBack').classList.add('show');
    const restore = () => { $('#modalSave').style.display = ''; };
    $('#modalBack').addEventListener('click', restore, { once: true });
  } catch (e) { alert('Test failed: ' + e.message); }
}

/* ---------- Setup ---------- */
RENDER.setup = function () {
  const v = $('#view'); v.innerHTML = '';
  const tab = S._setupTab || 'Station';
  const role = (S.user || API.user || {}).role;
  const tabs = ['Station', 'Products', 'Nozzles', 'Staff', 'Customers', 'Categories', 'Payroll'];
  if (role === 'owner' || role === 'admin') tabs.push('Users');
  if (role === 'owner') tabs.push('Pumps');
  v.appendChild(subtabs(tabs, tab, t => { S._setupTab = t; render(); }));

  if (tab === 'Station') {
    const c = el('div', { class: 'card' }); c.innerHTML = `<div class="card-head"><h3>Station details</h3></div>`;
    const grid = el('div', { class: 'form-grid' });
    [['name', 'Station Name'], ['dealer', 'Dealer / Proprietor'], ['omc', 'OMC (IOCL/BPCL/HPCL)'], ['code', 'RO / Dealer Code'], ['gstin', 'GSTIN'], ['address', 'Address']].forEach(([k, l]) => {
      const f = el('div', { class: 'field' }); f.appendChild(el('label', {}, l)); const i = el('input', { type: 'text', value: S.station[k] || '' });
      i.onchange = async () => { S.station[k] = i.value; try { await saveKV('station'); } catch (e) { } $('#brandName').textContent = S.station.name; }; f.appendChild(i); grid.appendChild(f);
    });
    c.appendChild(grid); v.appendChild(c);
    const s2 = el('div', { class: 'card', style: 'margin-top:16px' }); s2.innerHTML = `<div class="card-head"><h3>Dealer commission &amp; assumptions</h3></div>`;
    const g2 = el('div', { class: 'form-grid' });
    [['msCommission', 'MS Commission ₹/L'], ['hsdCommission', 'HSD Commission ₹/L'], ['oilMarginPct', 'Oil Margin %']].forEach(([k, l]) => { const f = el('div', { class: 'field' }); f.appendChild(el('label', {}, l)); const i = el('input', { type: 'number', step: '0.01', value: S.settings[k] }); i.onchange = async () => { S.settings[k] = num(i.value); try { await saveKV('settings'); toast('Saved'); } catch (e) { } }; f.appendChild(i); g2.appendChild(f); });
    s2.appendChild(g2); v.appendChild(s2);
  } else if (tab === 'Products') {
    topBtn('+ Add product', () => editProduct());
    v.appendChild(table([{ label: 'Code', val: r => r.code }, { label: 'Product', val: r => r.name }, { label: 'Unit price ₹/L', num: true, val: r => fmt(r.price, 2) }, { label: 'Cost ₹/L', num: true, val: r => fmt(r.cost, 2) }, { label: 'Margin ₹/L', num: true, calc: true, val: r => fmt(round2(num(r.price) - num(r.cost)), 2) }, { label: 'Tanks', val: r => r.tanks }], S.products, { actions: true, onEdit: editProduct, onDelete: r => confirmDel('Delete product?', () => dbDelete('products', r.id)) }));
  } else if (tab === 'Nozzles') {
    topBtn('+ Add nozzle', () => editNozzle());
    v.appendChild(table([{ label: 'Dispenser', val: r => r.dispenser }, { label: 'Nozzle', val: r => r.nozzle }, { label: 'Product', val: r => `<span class="pill ${r.product === 'MS' ? 'ms' : 'hsd'}">${r.product}</span>`, html: true }], S.nozzles, { actions: true, onEdit: editNozzle, onDelete: r => confirmDel('Delete nozzle?', () => dbDelete('nozzles', r.id)) }));
  } else if (tab === 'Staff') {
    topBtn('+ Add staff', () => editStaff());
    v.appendChild(table([{ label: 'Name', val: r => r.name }, { label: 'Role', val: r => r.role }, { label: 'Salary ₹', num: true, val: r => fmt(r.salary) }, { label: 'Phone', val: r => r.phone || '—' }, { label: 'Status', val: r => `<span class="pill ${r.status === 'Active' ? 'ok' : 'bad'}">${r.status}</span>`, html: true }], S.staff, { actions: true, onEdit: editStaff, onDelete: r => confirmDel('Delete staff?', () => dbDelete('staff', r.id)) }));
  } else if (tab === 'Customers') {
    topBtn('+ Add customer', () => editCustomer());
    v.appendChild(table([{ label: 'Name', val: r => r.name }, { label: 'Type', val: r => r.type }, { label: 'Opening ₹', num: true, val: r => fmt(r.opening) }, { label: 'Limit ₹', num: true, val: r => r.limit ? fmt(r.limit) : '—' }, { label: 'Phone', val: r => r.phone || '—' }], S.customers, { actions: true, onEdit: editCustomer, onDelete: r => confirmDel('Delete customer?', () => dbDelete('customers', r.id)) }));
  } else if (tab === 'Categories') {
    const c = el('div', { class: 'card' }); c.innerHTML = `<div class="card-head"><h3>Expense categories</h3></div><div class="hint">One per line.</div>`;
    const ta = el('textarea', { rows: 12 }); ta.value = S.expenseCategories.join('\n'); ta.onchange = async () => { S.expenseCategories = ta.value.split('\n').map(x => x.trim()).filter(Boolean); try { await saveKV('expenseCategories'); toast('Saved'); } catch (e) { } }; c.appendChild(ta); v.appendChild(c);
  } else if (tab === 'Payroll') {
    const c = el('div', { class: 'card' }); c.innerHTML = `<div class="card-head"><h3>Payroll settings</h3></div>`;
    const g = el('div', { class: 'form-grid' });
    [['standardDays', 'Standard days / month'], ['otRate', 'OT rate ₹/hour'], ['hoursPerDay', 'Working hours / day']].forEach(([k, l]) => { const f = el('div', { class: 'field' }); f.appendChild(el('label', {}, l)); const i = el('input', { type: 'number', value: S.payroll[k] }); i.onchange = async () => { S.payroll[k] = num(i.value); try { await saveKV('payroll'); toast('Saved'); } catch (e) { } }; f.appendChild(i); g.appendChild(f); });
    c.appendChild(g); v.appendChild(c);
  } else if (tab === 'Users') {
    const roleOpts = (S.roles || []).filter(r => r.v !== 'owner');
    topBtn('+ Add user', () => openForm('Add user', [
      { key: 'mobile', label: 'Mobile number (login)', type: 'tel', value: '' },
      { key: 'name', label: 'Name', type: 'text', value: '' },
      { key: 'password', label: 'Password', type: 'text', value: '' },
      { key: 'role', label: 'Role', type: 'select', options: roleOpts, value: 'attendant' },
    ], async d => { if (!d.mobile || !d.password) { alert('Mobile number and password are required'); return false; } await API.addUser(d.mobile.trim(), d.name.trim(), d.password, d.role); toast('User created'); renderUsersList(); }));
    const c = el('div', { class: 'card' });
    c.innerHTML = `<div class="card-head"><h3>Users of ${esc((S.user || {}).firmName || 'this pump')}</h3></div><div class="hint">Users sign in with their <b>mobile number</b> and password. Roles limit what each person can do. You are <b>${esc((S.user || {}).name || (S.user || {}).mobile || '')}</b> (${esc(roleLabel((S.user || {}).role))}).</div><div id="usersList" class="hint">Loading…</div>`;
    v.appendChild(c); renderUsersList();
  } else if (tab === 'Pumps') {
    topBtn('+ Add pump', () => openForm('Add petrol pump', [
      { key: 'name', label: 'Pump / station name', type: 'text', value: '', wide: true },
      { key: 'code', label: 'Dealer code (optional)', type: 'text', value: '' },
      { key: 'adminMobile', label: 'Pump admin mobile (login)', type: 'tel', value: '' },
      { key: 'adminPassword', label: 'Pump admin password', type: 'text', value: '' },
    ], async d => {
      if (!d.name || !d.adminMobile || !d.adminPassword) { alert('Pump name, admin mobile and password are required'); return false; }
      await API.addFirm({ name: d.name.trim(), code: d.code.trim(), adminMobile: d.adminMobile.trim(), adminPassword: d.adminPassword });
      S.firms = await API.listFirms(); toast('Pump created'); render();
    }));
    const c = el('div', { class: 'card' });
    c.innerHTML = `<div class="card-head"><h3>Petrol pumps</h3></div><div class="hint">Each pump is fully isolated — its own data, staff, customers and alerts. Add a pump and share the admin mobile/password. Use <b>Open</b> to view/support any pump; the pump admin signs in and sees only theirs.</div><div id="pumpsBody" class="hint">Loading…</div>`;
    v.appendChild(c);
    API.overview().then(ov => {
      const box = $('#pumpsBody'); box.innerHTML = '';
      const wrap = el('div', { class: 'tbl-wrap' }); const t = el('table');
      t.innerHTML = '<thead><tr><th>Pump</th><th>Code</th><th class="num">Users</th><th class="num">Entries</th><th class="num">Today ₹</th><th class="num">Outstanding ₹</th><th></th></tr></thead>';
      const tb = el('tbody');
      ov.forEach(p => {
        const tr = el('tr');
        tr.appendChild(el('td', {}, esc(p.name)));
        tr.appendChild(el('td', {}, esc(p.code || '—')));
        tr.appendChild(el('td', { class: 'num' }, p.users));
        tr.appendChild(el('td', { class: 'num' }, p.entries));
        tr.appendChild(el('td', { class: 'num' }, fmt(p.todaySale)));
        tr.appendChild(el('td', { class: 'num' }, fmt(p.outstanding)));
        const ac = el('td');
        if (p.id !== (S.user || {}).firmId) { const b = el('button', { class: 'btn sm' }, 'Open'); b.onclick = () => openPump(p.id); ac.appendChild(b); }
        else ac.appendChild(el('span', { class: 'tag' }, 'current'));
        tr.appendChild(ac); tb.appendChild(tr);
      });
      t.appendChild(tb); wrap.appendChild(t); box.appendChild(wrap);
    }).catch(e => { const box = $('#pumpsBody'); if (box) box.textContent = e.message; });
  }
};
async function openPump(firmId) {
  try {
    const r = await API.impersonate(firmId);
    if (!localStorage.getItem('afs_home_token')) localStorage.setItem('afs_home_token', API.token);
    API.token = r.token; localStorage.setItem('afs_token', r.token);
    current = 'dashboard'; await boot(); toast('Viewing ' + r.firmName);
  } catch (e) { alert(e.message); }
}
async function renderUsersList() {
  const box = $('#usersList'); if (!box) return;
  try {
    const users = await API.listUsers();
    box.innerHTML = '';
    const t = el('table'); t.innerHTML = '<thead><tr><th>Mobile</th><th>Name</th><th>Role</th><th></th></tr></thead>'; const tb = el('tbody');
    users.forEach(u => {
      const tr = el('tr');
      tr.appendChild(el('td', {}, esc(u.mobile)));
      tr.appendChild(el('td', {}, esc(u.name || '—')));
      tr.appendChild(el('td', { html: `<span class="pill ${u.role === 'owner' ? 'ok' : u.role === 'admin' ? 'ms' : ''}">${u.role}</span>` }));
      const ac = el('td');
      if (u.role !== 'owner' && u.mobile !== (S.user || {}).mobile) { const b = el('button', { class: 'icon-btn del' }, '🗑'); b.onclick = async () => { if (confirm('Remove user ' + u.mobile + '?')) { try { await API.delUser(u.id); renderUsersList(); toast('Removed'); } catch (e) { alert(e.message); } } }; ac.appendChild(b); }
      tr.appendChild(ac); tb.appendChild(tr);
    });
    t.appendChild(tb); const w = el('div', { class: 'tbl-wrap' }); w.appendChild(t); box.appendChild(w);
  } catch (e) { box.textContent = e.message; }
}
function editProduct(r) { openForm(r ? 'Edit product' : 'Add product', [{ key: 'code', label: 'Code (MS/HSD)', type: 'text', value: r ? r.code : '' }, { key: 'name', label: 'Product name', type: 'text', value: r ? r.name : '' }, { key: 'price', label: 'Unit price ₹/L', type: 'number', step: '0.01', value: r ? r.price : 0 }, { key: 'cost', label: 'Cost ₹/L', type: 'number', step: '0.01', value: r ? r.cost : 0 }, { key: 'tanks', label: 'Tank(s)', type: 'text', value: r ? r.tanks : '' }], async d => { const rec = { code: d.code, name: d.name, price: num(d.price), cost: num(d.cost), tanks: d.tanks }; if (r) await dbUpdate('products', r.id, rec); else await dbCreate('products', rec); toast('Saved'); }); }
function editNozzle(r) { openForm(r ? 'Edit nozzle' : 'Add nozzle', [{ key: 'dispenser', label: 'Dispenser', type: 'text', value: r ? r.dispenser : '' }, { key: 'nozzle', label: 'Nozzle', type: 'text', value: r ? r.nozzle : '' }, { key: 'product', label: 'Product', type: 'select', options: ['MS', 'HSD'], value: r ? r.product : 'MS' }], async d => { const rec = { dispenser: d.dispenser, nozzle: d.nozzle, product: d.product }; if (r) await dbUpdate('nozzles', r.id, rec); else await dbCreate('nozzles', rec); toast('Saved'); }); }
function editStaff(r) { openForm(r ? 'Edit staff' : 'Add staff', [{ key: 'name', label: 'Name', type: 'text', value: r ? r.name : '', wide: true }, { key: 'role', label: 'Role', type: 'text', value: r ? r.role : 'Pump Boy' }, { key: 'salary', label: 'Monthly salary ₹', type: 'number', value: r ? r.salary : 0 }, { key: 'phone', label: 'Phone', type: 'text', value: r ? r.phone : '' }, { key: 'joinDate', label: 'Join date', type: 'date', value: r ? r.joinDate : '' }, { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Left'], value: r ? r.status : 'Active' }], async d => { const rec = { name: d.name, role: d.role, salary: num(d.salary), phone: d.phone, joinDate: d.joinDate, status: d.status }; if (r) await dbUpdate('staff', r.id, rec); else await dbCreate('staff', rec); toast('Saved'); }); }
function editCustomer(r) { openForm(r ? 'Edit customer' : 'Add customer', [{ key: 'name', label: 'Customer name', type: 'text', value: r ? r.name : '', wide: true }, { key: 'type', label: 'Type', type: 'text', value: r ? r.type : 'Regular' }, { key: 'opening', label: 'Opening balance ₹', type: 'number', value: r ? r.opening : 0 }, { key: 'limit', label: 'Credit limit ₹', type: 'number', value: r ? r.limit : 0 }, { key: 'phone', label: 'Phone', type: 'text', value: r ? r.phone : '' }], async d => { const rec = { name: d.name, type: d.type, opening: num(d.opening), limit: num(d.limit), phone: d.phone }; if (r) await dbUpdate('customers', r.id, rec); else await dbCreate('customers', rec); toast('Saved'); }); }

/* ============================================================
   DATA I/O + AUTH + BOOT
   ============================================================ */
const App = {
  exportData() {
    const doc = {}; Object.keys(S).forEach(k => { if (k[0] !== '_' && k !== 'user') doc[k] = S[k]; });
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'afs_backup_' + todayISO() + '.json' }); document.body.appendChild(a); a.click(); a.remove(); toast('Backup downloaded');
  },
  importData(ev) {
    const f = ev.target.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = async () => { try { const doc = JSON.parse(fr.result); if (!confirm('Import will REPLACE all current data with the backup. Continue?')) return; await API.importData(doc); S = normalize(await API.getState()); go('dashboard'); toast('Data restored'); } catch (e) { alert('Import failed: ' + e.message); } };
    fr.readAsText(f); ev.target.value = '';
  },
  async clearData() {
    const typed = prompt('This permanently deletes ALL transactional data (sales, credit, cash, expenses, shifts, attendance…). Master data is kept.\n\nExport a backup first. To confirm, type DELETE below:');
    if (typed !== 'DELETE') { if (typed !== null) alert('Not cleared — you must type DELETE exactly.'); return; }
    try { await API.clearData(); S = normalize(await API.getState()); go('dashboard'); toast('Data cleared'); }
    catch (e) { alert(/permission/i.test(e.message) ? 'Only the owner or pump admin can clear data.' : e.message); }
  },
  closeModal,
};

function mountUser() {
  const u = API.user || {}; const label = u.name || u.mobile || '?'; const initial = label[0].toUpperCase();
  $('#userChip').innerHTML = `<div class="av">${esc(initial)}</div><div><div>${esc(label)}</div><div class="role">${esc(roleLabel(u.role))}</div></div>`;
  // backup safety: Restore = owner only; Clear = owner/admin
  const role = u.role;
  const rb = $('#btnRestore'), cb = $('#btnClear');
  if (rb) rb.style.display = role === 'owner' ? '' : 'none';
  if (cb) cb.style.display = (role === 'owner' || role === 'admin') ? '' : 'none';
}
function showLogin(msg) { $('#appRoot').style.display = 'none'; $('#authOverlay').classList.add('show'); $('#loginErr').textContent = msg || ''; setTimeout(() => $('#loginUser').focus(), 50); }
function hideLogin() { $('#authOverlay').classList.remove('show'); $('#appRoot').style.display = ''; }
function initials(name) { const caps = String(name || '').replace(/[^A-Z]/g, ''); return (caps.length >= 2 ? caps.slice(0, 2) : String(name || 'PS').slice(0, 2)).toUpperCase(); }
async function brandLogin() { try { const c = await API.config(); if (c.appName) { $('#loginTitle').textContent = c.appName; $('#loginLogo').textContent = initials(c.appName); $('#navLogo').textContent = initials(c.appName); document.title = c.appName + ' — Fuel Station Operations'; } } catch (e) { } }

async function boot() {
  try {
    const st = await API.getState(); S = normalize(st); API.user = st.user || API.user;
    if (S.appName) { $('#navLogo').textContent = initials(S.appName); document.title = S.appName + ' — Fuel Station Operations'; }
    hideLogin(); mountUser(); buildNav(); render();
  } catch (e) {
    if (e.unauth) showLogin(); else if (e.network) showLogin('Cannot reach the server.'); else showLogin(e.message);
  }
}

(function () {
  brandLogin();
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('#loginErr').textContent = 'Signing in…';
    try { await API.login($('#loginUser').value.trim(), $('#loginPass').value); await boot(); }
    catch (err) { $('#loginErr').textContent = err.message === 'unauthorized' ? 'Invalid mobile number or password' : err.message; }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  $('#modalBack').addEventListener('click', e => { if (e.target.id === 'modalBack') closeModal(); });
  const ham = $('#hamburger'); if (ham) ham.onclick = () => document.querySelector('.app').classList.toggle('nav-open');
  if (API.token) boot(); else showLogin();
})();

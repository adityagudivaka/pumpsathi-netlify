'use strict';
const store = require('./store');
const reports = require('./reports');
const messaging = require('./messaging');

function hhmmToMin(s) { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : 24 * 60; }
function isoWeek(d) { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return t.getUTCFullYear() + '-W' + Math.ceil((((t - ys) / 864e5) + 1) / 7); }

// Netlify schedulers run in UTC; India = UTC+5:30. Convert so "send at 21:30" means IST.
function istNow() { return new Date(Date.now() + 330 * 60 * 1000); }

async function run() {
  const now = istNow();
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();   // istNow shifted, read as UTC parts
  const today = now.toISOString().slice(0, 10);
  const weekday = now.getUTCDay();
  const week = isoWeek(now);
  const firms = await store.listFirms();
  for (const firm of firms) {
    const a = await store.kvGet(firm.id, 'alerts', null);
    if (!a || !a.enabled || !(a.recipients || []).some((r) => r.active !== false && r.number)) continue;
    const t = a.types || {};
    const dailyMin = hhmmToMin((t.dailySales && t.dailySales.time) || '21:30');
    if (nowMin >= dailyMin) {
      if (t.dailySales?.on) { const k = `${firm.id}:dailySales:${today}`; if (!await store.stampDone(k)) { await store.stampMark(k); await messaging.broadcast(firm.id, a.recipients, await reports.dailySales(firm.id, today), { kind: 'dailySales' }); } }
      if (t.compliance?.on) { const k = `${firm.id}:compliance:${today}`; if (!await store.stampDone(k)) { const m = await reports.compliance(firm.id, t.compliance.daysAhead || 30); await store.stampMark(k); if (m) await messaging.broadcast(firm.id, a.recipients, m, { kind: 'compliance' }); } }
      if (t.outstandingCredit?.on) { const k = `${firm.id}:credit:${today}`; if (!await store.stampDone(k)) { const m = await reports.outstandingCredit(firm.id, t.outstandingCredit.threshold || 0); await store.stampMark(k); if (m) await messaging.broadcast(firm.id, a.recipients, m, { kind: 'outstandingCredit' }); } }
    }
    if (t.weeklyAttendance?.on && weekday === (t.weeklyAttendance.weekday ?? 1) && nowMin >= 9 * 60) {
      const k = `${firm.id}:attendance:${week}`; if (!await store.stampDone(k)) { await store.stampMark(k); await messaging.broadcast(firm.id, a.recipients, await reports.weeklyAttendance(firm.id), { kind: 'weeklyAttendance' }); }
    }
  }
}
module.exports = { run };

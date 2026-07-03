'use strict';
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const config = require('./config');
const store = require('./store');
const { COLLECTIONS, KV_KEYS, MASTER } = require('./collections');
const { ensureBootstrap, seedFirm, DEFAULT_ALERTS } = require('./seed');
const { login, requireAuth, requireRole, issueToken } = require('./auth');
const perms = require('./permissions');
const reports = require('./reports');
const messaging = require('./messaging');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const api = express.Router();
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => { console.error(e); res.status(500).json({ error: e.message || 'Server error' }); });
const firmId = (req) => req.user.firmId;

// ensure the owner/firm exists (runs once per cold start)
api.use((req, res, next) => { ensureBootstrap().then(() => next()).catch(next); });

api.post('/auth/login', wrap(async (req, res) => {
  const { mobile, password } = req.body || {};
  if (!mobile || !password) return res.status(400).json({ error: 'Mobile number and password required' });
  const r = await login(mobile, password);
  if (!r) return res.status(401).json({ error: 'Invalid mobile number or password' });
  res.json(r);
}));

api.use(requireAuth);
api.get('/auth/me', (req, res) => res.json({ user: req.user }));

api.get('/state', wrap(async (req, res) => {
  const f = firmId(req); const state = {};
  for (const name of Object.keys(COLLECTIONS)) state[name] = await store.listAll(f, name);
  state.station = await store.kvGet(f, 'station', {});
  state.payroll = await store.kvGet(f, 'payroll', {});
  state.settings = await store.kvGet(f, 'settings', {});
  state.expenseCategories = await store.kvGet(f, 'expenseCategories', []);
  state.attendance = await store.kvGet(f, 'attendance', {});
  state.alerts = await store.kvGet(f, 'alerts', DEFAULT_ALERTS);
  const firm = await store.getFirm(f);
  state.user = { ...req.user, firmName: firm ? firm.name : '' };
  state.appName = config.appName; state.waConfigured = messaging.configured();
  state.permissions = { edit: perms.editableAreas(req.user.role), view: perms.viewableAreas(req.user.role) };
  state.roles = perms.ROLES.map((r) => ({ v: r, t: perms.ROLE_LABELS[r] }));
  if (req.user.role === 'owner') { state.firms = await store.listFirms(); state.impersonating = req.user.sup ? (req.user.homeFirm || null) : null; }
  res.json(state);
}));

function checkColl(req, res) { const n = req.params.coll; if (!Object.prototype.hasOwnProperty.call(COLLECTIONS, n)) { res.status(404).json({ error: 'Unknown collection: ' + n }); return null; } return n; }
// gate a write by the caller's role for the collection's area
function guardColl(req, res, n) { const area = perms.COLLECTION_AREA[n] || 'setup'; if (!perms.canEdit(req.user.role, area)) { res.status(403).json({ error: 'Your role cannot modify ' + area }); return false; } return true; }
api.post('/c/:coll', wrap(async (req, res) => { const n = checkColl(req, res); if (!n) return; if (!guardColl(req, res, n)) return; const row = await store.insert(firmId(req), n, req.body || {}); await store.audit(firmId(req), req.user.mobile, 'create ' + n, perms.COLLECTION_AREA[n], row.id); res.status(201).json(row); }));
api.put('/c/:coll/:id', wrap(async (req, res) => { const n = checkColl(req, res); if (!n) return; if (!guardColl(req, res, n)) return; const row = await store.update(firmId(req), n, req.params.id, req.body || {}); if (!row) return res.status(404).json({ error: 'Record not found' }); await store.audit(firmId(req), req.user.mobile, 'update ' + n, perms.COLLECTION_AREA[n], req.params.id); res.json(row); }));
api.delete('/c/:coll/:id', wrap(async (req, res) => { const n = checkColl(req, res); if (!n) return; if (!guardColl(req, res, n)) return; if (!await store.remove(firmId(req), n, req.params.id)) return res.status(404).json({ error: 'Record not found' }); await store.audit(firmId(req), req.user.mobile, 'delete ' + n, perms.COLLECTION_AREA[n], req.params.id); res.status(204).end(); }));

api.put('/kv/:key', wrap(async (req, res) => { const key = req.params.key; if (!KV_KEYS.includes(key)) return res.status(404).json({ error: 'Unknown setting: ' + key }); const area = perms.KV_AREA[key] || 'setup'; if (!perms.canEdit(req.user.role, area)) return res.status(403).json({ error: 'Your role cannot modify ' + area }); const value = (req.body && 'value' in req.body) ? req.body.value : req.body; await store.kvSet(firmId(req), key, value); await store.audit(firmId(req), req.user.mobile, 'update ' + key, area, ''); res.json({ key, value }); }));

api.post('/admin/clear', requireRole('owner', 'admin'), wrap(async (req, res) => { const f = firmId(req); for (const n of Object.keys(COLLECTIONS)) if (!MASTER.has(n)) await store.clearCollection(f, n); await store.kvSet(f, 'attendance', {}); await store.audit(f, req.user.mobile, 'CLEAR all data', 'setup', ''); res.json({ ok: true }); }));
api.post('/admin/import', requireRole('owner'), wrap(async (req, res) => { const f = firmId(req); const doc = req.body || {}; for (const n of Object.keys(COLLECTIONS)) { if (!Array.isArray(doc[n])) continue; await store.clearCollection(f, n); for (const rec of doc[n]) await store.insert(f, n, rec); } for (const k of KV_KEYS) if (doc[k] !== undefined) await store.kvSet(f, k, doc[k]); await store.audit(f, req.user.mobile, 'RESTORE backup', 'setup', ''); res.json({ ok: true }); }));

api.get('/audit', requireRole('owner', 'admin', 'auditor'), wrap(async (req, res) => res.json(await store.auditList(firmId(req)))));

api.get('/users', requireRole('owner', 'admin'), wrap(async (req, res) => res.json(await store.usersOfFirm(firmId(req)))));
api.post('/users', requireRole('owner', 'admin'), wrap(async (req, res) => {
  const { mobile, name, password, role } = req.body || {};
  if (!mobile || !password) return res.status(400).json({ error: 'Mobile number and password required' });
  if (await store.userByMobile(mobile)) return res.status(409).json({ error: 'A user with this mobile already exists' });
  // admins can only create non-owner roles; owner can create admin/staff/operational (not another owner via UI)
  let r = perms.ROLES.includes(role) ? role : 'attendant';
  if (r === 'owner') r = 'admin';
  const u = await store.createUser(mobile, name || '', bcrypt.hashSync(password, 10), r, firmId(req));
  await store.audit(firmId(req), req.user.mobile, 'create user ' + mobile + ' (' + r + ')', 'users', u.id);
  res.status(201).json({ id: u.id, mobile: u.mobile, name: u.name, role: u.role });
}));
api.delete('/users/:id', requireRole('owner', 'admin'), wrap(async (req, res) => { if (!await store.deleteUser(firmId(req), req.params.id)) return res.status(404).json({ error: 'User not found or protected' }); await store.audit(firmId(req), req.user.mobile, 'delete user', 'users', req.params.id); res.status(204).end(); }));

api.get('/firms', requireRole('owner'), wrap(async (req, res) => res.json(await store.listFirms())));
api.post('/firms', requireRole('owner'), wrap(async (req, res) => {
  const { name, code, adminMobile, adminPassword } = req.body || {};
  if (!name || !adminMobile || !adminPassword) return res.status(400).json({ error: 'Pump name, admin mobile and password are required' });
  if (await store.userByMobile(adminMobile)) return res.status(409).json({ error: 'That admin mobile is already registered' });
  const firm = await store.createFirm(name, code || '');
  await seedFirm(firm.id);
  await store.kvSet(firm.id, 'station', { name, dealer: '', omc: '', code: code || '', gstin: '', address: '' });
  await store.createUser(adminMobile, name + ' Admin', bcrypt.hashSync(adminPassword, 10), 'admin', firm.id);
  await store.audit(req.user.firmId, req.user.mobile, 'create pump ' + name, 'pumps', firm.id);
  res.status(201).json({ firm, adminMobile });
}));

// Super-admin: cross-pump overview
api.get('/admin/overview', requireRole('owner'), wrap(async (req, res) => {
  const firms = await store.listFirms();
  const today = new Date().toISOString().slice(0, 10);
  const out = [];
  for (const firm of firms) {
    const [sales, users, priceLog, products, custs, led] = await Promise.all([
      store.listAll(firm.id, 'dailySales'), store.usersOfFirm(firm.id), store.listAll(firm.id, 'priceLog'),
      store.listAll(firm.id, 'products'), store.listAll(firm.id, 'customers'), store.listAll(firm.id, 'credit'),
    ]);
    const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
    const priceOn = (d, prod) => { let b = null; for (const p of priceLog) if (p.date <= d && (!b || p.date > b.date)) b = p; if (!b) { const pr = products.find((x) => x.code === prod); return pr ? num(pr.price) : 0; } return prod === 'MS' ? num(b.ms) : num(b.hsd); };
    let todaySale = 0; sales.filter((s) => s.date === today).forEach((s) => { const diff = num(s.close) - num(s.open); todaySale += (diff - num(s.test)) * priceOn(s.date, s.prod); });
    const outstanding = custs.reduce((a, c) => { const g = led.filter((x) => x.customer === c.name).reduce((x, y) => x + num(y.given), 0); const p = led.filter((x) => x.customer === c.name).reduce((x, y) => x + num(y.paid), 0); return a + num(c.opening) + g - p; }, 0);
    out.push({ id: firm.id, name: firm.name, code: firm.code, users: users.length, entries: sales.length, todaySale: Math.round(todaySale), outstanding: Math.round(outstanding) });
  }
  res.json(out);
}));
// Super-admin: get a scoped token to open/support a specific pump
api.post('/admin/impersonate', requireRole('owner'), wrap(async (req, res) => {
  const { firmId: target } = req.body || {};
  const firm = await store.getFirm(target);
  if (!firm) return res.status(404).json({ error: 'Pump not found' });
  await store.audit(req.user.firmId, req.user.mobile, 'open pump ' + firm.name + ' (support)', 'pumps', firm.id);
  // support session token scoped to the target pump; homeFirm lets the UI exit back
  const jwt = require('jsonwebtoken');
  const supToken = jwt.sign({ sub: req.user.sub, mobile: req.user.mobile, name: req.user.name, role: 'owner', firmId: target, sup: true, homeFirm: req.user.sup ? req.user.homeFirm : req.user.firmId }, config.jwtSecret, { expiresIn: config.jwtExpires });
  res.json({ token: supToken, firmName: firm.name });
}));

api.post('/alerts/test', requireRole('owner', 'admin'), wrap(async (req, res) => {
  const f = firmId(req); const type = (req.body || {}).type || 'dailySales';
  const a = await store.kvGet(f, 'alerts', DEFAULT_ALERTS);
  let msg;
  if (type === 'compliance') msg = await reports.compliance(f, (a.types.compliance || {}).daysAhead || 30);
  else if (type === 'outstandingCredit') msg = await reports.outstandingCredit(f, (a.types.outstandingCredit || {}).threshold || 0);
  else if (type === 'weeklyAttendance') msg = await reports.weeklyAttendance(f);
  else msg = await reports.dailySales(f, (req.body || {}).date);
  if (!msg) return res.json({ preview: '(nothing to report right now)', sent: 0, configured: messaging.configured(), results: [] });
  res.json(await messaging.broadcast(f, a.recipients, msg, { kind: type }));
}));
api.get('/alerts/recent', requireRole('owner', 'admin'), wrap(async (req, res) => res.json({ configured: messaging.configured(), recent: await store.waRecent(firmId(req)) })));

// health & config live outside auth
app.get(['/api/health', '/.netlify/functions/api/health'], (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
app.get(['/api/config', '/.netlify/functions/api/config'], (req, res) => res.json({ appName: config.appName, waConfigured: messaging.configured() }));

// Diagnostics — confirms whether Netlify Blobs storage is reachable (no auth)
app.get(['/api/diag', '/.netlify/functions/api/diag'], async (req, res) => {
  const out = {
    node: process.version,
    hasBlobsContext: !!process.env.NETLIFY_BLOBS_CONTEXT,
    hasSiteId: !!(process.env.NETLIFY_SITE_ID || process.env.SITE_ID),
    hasManualToken: !!(process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN),
    waConfigured: messaging.configured(),
  };
  try { await store.kvSet('__diag__', 'ping', { t: Date.now() }); out.blobs = 'ok'; }
  catch (e) { out.blobs = 'FAIL: ' + e.message; }
  res.json(out);
});

// mount the router at both the public path and the raw function path
app.use(['/api', '/.netlify/functions/api'], api);

// JSON error handler — so failures return a readable message instead of a bare 500
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[api-error]', err && err.stack ? err.stack : err);
  const msg = (err && err.message) || 'Server error';
  const blobsHint = /Blobs/i.test(msg) ? ' — storage not configured; see /api/diag' : '';
  res.status(500).json({ error: msg + blobsHint });
});

module.exports = app;

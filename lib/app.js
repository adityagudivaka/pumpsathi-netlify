'use strict';
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const config = require('./config');
const store = require('./store');
const { COLLECTIONS, KV_KEYS, MASTER } = require('./collections');
const { ensureBootstrap, seedFirm, DEFAULT_ALERTS } = require('./seed');
const { login, requireAuth, requireRole } = require('./auth');
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
  if (req.user.role === 'owner') state.firms = await store.listFirms();
  res.json(state);
}));

function checkColl(req, res) { const n = req.params.coll; if (!Object.prototype.hasOwnProperty.call(COLLECTIONS, n)) { res.status(404).json({ error: 'Unknown collection: ' + n }); return null; } return n; }
api.post('/c/:coll', wrap(async (req, res) => { const n = checkColl(req, res); if (!n) return; res.status(201).json(await store.insert(firmId(req), n, req.body || {})); }));
api.put('/c/:coll/:id', wrap(async (req, res) => { const n = checkColl(req, res); if (!n) return; const row = await store.update(firmId(req), n, req.params.id, req.body || {}); if (!row) return res.status(404).json({ error: 'Record not found' }); res.json(row); }));
api.delete('/c/:coll/:id', wrap(async (req, res) => { const n = checkColl(req, res); if (!n) return; if (!await store.remove(firmId(req), n, req.params.id)) return res.status(404).json({ error: 'Record not found' }); res.status(204).end(); }));

api.put('/kv/:key', wrap(async (req, res) => { const key = req.params.key; if (!KV_KEYS.includes(key)) return res.status(404).json({ error: 'Unknown setting: ' + key }); const value = (req.body && 'value' in req.body) ? req.body.value : req.body; await store.kvSet(firmId(req), key, value); res.json({ key, value }); }));

api.post('/admin/clear', requireRole('owner', 'admin'), wrap(async (req, res) => { const f = firmId(req); for (const n of Object.keys(COLLECTIONS)) if (!MASTER.has(n)) await store.clearCollection(f, n); await store.kvSet(f, 'attendance', {}); res.json({ ok: true }); }));
api.post('/admin/import', requireRole('owner', 'admin'), wrap(async (req, res) => { const f = firmId(req); const doc = req.body || {}; for (const n of Object.keys(COLLECTIONS)) { if (!Array.isArray(doc[n])) continue; await store.clearCollection(f, n); for (const rec of doc[n]) await store.insert(f, n, rec); } for (const k of KV_KEYS) if (doc[k] !== undefined) await store.kvSet(f, k, doc[k]); res.json({ ok: true }); }));

api.get('/users', requireRole('owner', 'admin'), wrap(async (req, res) => res.json(await store.usersOfFirm(firmId(req)))));
api.post('/users', requireRole('owner', 'admin'), wrap(async (req, res) => {
  const { mobile, name, password, role } = req.body || {};
  if (!mobile || !password) return res.status(400).json({ error: 'Mobile number and password required' });
  if (await store.userByMobile(mobile)) return res.status(409).json({ error: 'A user with this mobile already exists' });
  const u = await store.createUser(mobile, name || '', bcrypt.hashSync(password, 10), role === 'admin' ? 'admin' : 'staff', firmId(req));
  res.status(201).json({ id: u.id, mobile: u.mobile, name: u.name, role: u.role });
}));
api.delete('/users/:id', requireRole('owner', 'admin'), wrap(async (req, res) => { if (!await store.deleteUser(firmId(req), req.params.id)) return res.status(404).json({ error: 'User not found or protected' }); res.status(204).end(); }));

api.get('/firms', requireRole('owner'), wrap(async (req, res) => res.json(await store.listFirms())));
api.post('/firms', requireRole('owner'), wrap(async (req, res) => {
  const { name, code, adminMobile, adminPassword } = req.body || {};
  if (!name || !adminMobile || !adminPassword) return res.status(400).json({ error: 'Firm name, admin mobile and password are required' });
  if (await store.userByMobile(adminMobile)) return res.status(409).json({ error: 'That admin mobile is already registered' });
  const firm = await store.createFirm(name, code || '');
  await seedFirm(firm.id);
  await store.kvSet(firm.id, 'station', { name, dealer: '', omc: '', code: code || '', gstin: '', address: '' });
  await store.createUser(adminMobile, name + ' Admin', bcrypt.hashSync(adminPassword, 10), 'admin', firm.id);
  res.status(201).json({ firm, adminMobile });
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

'use strict';
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const store = require('./store');
const config = require('./config');

function issueToken(u) { return jwt.sign({ sub: u.id, mobile: u.mobile, name: u.name, role: u.role, firmId: u.firm_id }, config.jwtSecret, { expiresIn: config.jwtExpires }); }

async function login(mobile, password) {
  const u = await store.userByMobile(mobile);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) return null;
  const firm = u.firm_id ? await store.getFirm(u.firm_id) : null;
  return { token: issueToken(u), user: { mobile: u.mobile, name: u.name, role: u.role, firmId: u.firm_id, firmName: firm ? firm.name : '' } };
}
function requireAuth(req, res, next) {
  const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'Authentication required' });
  try { req.user = jwt.verify(m[1], config.jwtSecret); if (!req.user.firmId) return res.status(401).json({ error: 'Session outdated — please sign in again' }); next(); }
  catch { return res.status(401).json({ error: 'Session expired — please sign in again' }); }
}
function requireRole(...roles) { return (req, res, next) => { if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' }); next(); }; }

module.exports = { login, requireAuth, requireRole };

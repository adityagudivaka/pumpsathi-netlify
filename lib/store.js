'use strict';
/*
 * Netlify Blobs–backed data store (async). Same surface as the SQLite store,
 * but every method returns a Promise. One JSON blob per firm-collection and
 * per firm-kv key. Fine for a single station's volume; low write concurrency.
 */
const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');
const { COLLECTIONS } = require('./collections');

function bs() {
  const opts = { name: 'pumpsathi', consistency: 'strong' };
  // Automatic context is injected by Netlify in production. If it's missing
  // (some deploy setups), fall back to manual config via env vars.
  if (!process.env.NETLIFY_BLOBS_CONTEXT) {
    const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
    const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN;
    if (siteID && token) { opts.siteID = siteID; opts.token = token; }
  }
  return getStore(opts);
}
const collKey = (firmId, name) => `f/${firmId}/c/${name}`;
const kvKey = (firmId, key) => `f/${firmId}/kv/${key}`;

async function getJSON(key, fallback) { const v = await bs().get(key, { type: 'json' }); return v == null ? fallback : v; }
async function setJSON(key, val) { await bs().setJSON(key, val); }

function coerce(type, v) {
  if (type === 'num') { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
  if (type === 'int') { if (v === '' || v === null || v === undefined) return null; const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
  return v === null || v === undefined ? '' : String(v);
}
function shape(name, rec, firmId, id, createdAt) {
  const cols = COLLECTIONS[name]; const now = new Date().toISOString();
  const out = { id, firm_id: firmId };
  for (const k of Object.keys(cols)) out[k] = coerce(cols[k], rec[k]);
  out.created_at = createdAt || now; out.updated_at = now; return out;
}

/* ---- collections ---- */
async function listAll(firmId, name) { return getJSON(collKey(firmId, name), []); }
async function insert(firmId, name, rec) {
  const arr = await listAll(firmId, name);
  const id = (rec.id && String(rec.id)) || crypto.randomUUID();
  const row = shape(name, rec, firmId, id);
  arr.push(row); await setJSON(collKey(firmId, name), arr); return row;
}
async function update(firmId, name, id, rec) {
  const arr = await listAll(firmId, name); const i = arr.findIndex((r) => r.id === id);
  if (i < 0) return null;
  const row = shape(name, rec, firmId, id, arr[i].created_at); arr[i] = row;
  await setJSON(collKey(firmId, name), arr); return row;
}
async function remove(firmId, name, id) {
  const arr = await listAll(firmId, name); const next = arr.filter((r) => r.id !== id);
  if (next.length === arr.length) return false;
  await setJSON(collKey(firmId, name), next); return true;
}
async function clearCollection(firmId, name) { await setJSON(collKey(firmId, name), []); }

/* ---- kv singletons ---- */
async function kvGet(firmId, key, fallback) { return getJSON(kvKey(firmId, key), fallback); }
async function kvSet(firmId, key, value) { await setJSON(kvKey(firmId, key), value); return value; }

/* ---- firms ---- */
async function listFirms() { return getJSON('firms', []); }
async function getFirm(id) { return (await listFirms()).find((f) => f.id === id) || null; }
async function createFirm(name, code) {
  const firms = await listFirms(); const firm = { id: crypto.randomUUID(), name, code: code || '', created_at: new Date().toISOString() };
  firms.push(firm); await setJSON('firms', firms); return firm;
}

/* ---- users ---- */
async function listUsersRaw() { return getJSON('users', []); }
async function userByMobile(mobile) { return (await listUsersRaw()).find((u) => u.mobile === String(mobile).trim()) || null; }
async function usersOfFirm(firmId) { return (await listUsersRaw()).filter((u) => u.firm_id === firmId).map((u) => ({ id: u.id, mobile: u.mobile, name: u.name, role: u.role, firm_id: u.firm_id, created_at: u.created_at })); }
async function userCount() { return (await listUsersRaw()).length; }
async function createUser(mobile, name, hash, role, firmId) {
  const users = await listUsersRaw(); const u = { id: crypto.randomUUID(), mobile: String(mobile).trim(), name: name || '', password_hash: hash, role: role || 'staff', firm_id: firmId || null, created_at: new Date().toISOString() };
  users.push(u); await setJSON('users', users); return { id: u.id, mobile: u.mobile, name: u.name, role: u.role, firm_id: u.firm_id };
}
async function deleteUser(firmId, id) {
  const users = await listUsersRaw(); const next = users.filter((u) => !(u.id === id && u.firm_id === firmId && u.role !== 'owner'));
  if (next.length === users.length) return false; await setJSON('users', next); return true;
}

/* ---- WhatsApp send log (global, capped) ---- */
async function waLog(entry) { const log = await getJSON('wa_log', []); log.unshift({ ts: new Date().toISOString(), ...entry }); await setJSON('wa_log', log.slice(0, 100)); }
async function waRecent(firmId) { return (await getJSON('wa_log', [])).filter((e) => !firmId || e.firmId === firmId).slice(0, 20); }

/* ---- cron dedup stamps (global, capped) ---- */
async function stampDone(key) { return (await getJSON('sent_stamps', [])).includes(key); }
async function stampMark(key) { const s = await getJSON('sent_stamps', []); if (!s.includes(key)) { s.unshift(key); await setJSON('sent_stamps', s.slice(0, 500)); } }

async function audit() { /* no-op on Netlify (kept for API parity) */ }

module.exports = {
  listAll, insert, update, remove, clearCollection, kvGet, kvSet,
  listFirms, getFirm, createFirm, userByMobile, usersOfFirm, userCount, createUser, deleteUser,
  waLog, waRecent, stampDone, stampMark, audit,
};

'use strict';
const config = require('./config');
const store = require('./store');

const configured = () =>
  (config.wa.provider === 'meta' && config.wa.token && config.wa.phoneId) ||
  (config.wa.provider === 'twilio' && config.wa.twilioSid && config.wa.twilioToken && config.wa.twilioFrom);

function normalize(number) { let n = String(number || '').replace(/[^\d+]/g, ''); if (!n) return ''; if (n.startsWith('+')) n = n.slice(1); if (n.length === 10) n = '91' + n; return n; }

async function sendMeta(to, text) {
  const url = `https://graph.facebook.com/${config.wa.apiVersion}/${config.wa.phoneId}/messages`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${config.wa.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }) });
  const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error?.message || `Meta API ${res.status}`); return data.messages?.[0]?.id || 'sent';
}
async function sendTwilio(to, text) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.wa.twilioSid}/Messages.json`;
  const body = new URLSearchParams({ To: `whatsapp:+${to}`, From: config.wa.twilioFrom, Body: text });
  const res = await fetch(url, { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${config.wa.twilioSid}:${config.wa.twilioToken}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.message || `Twilio ${res.status}`); return data.sid || 'sent';
}
async function broadcast(firmId, recipients, text, meta = {}) {
  const active = (recipients || []).filter((r) => r.active !== false && r.number);
  const results = [];
  for (const r of active) {
    const to = normalize(r.number);
    if (!to) { results.push({ to: r.number, ok: false, error: 'invalid number' }); continue; }
    if (!configured()) { results.push({ to, ok: true, dryRun: true }); await store.waLog({ firmId, to, kind: meta.kind, dryRun: true }); continue; }
    try { const id = config.wa.provider === 'twilio' ? await sendTwilio(to, text) : await sendMeta(to, text); results.push({ to, ok: true, id }); await store.waLog({ firmId, to, kind: meta.kind, id }); }
    catch (e) { results.push({ to, ok: false, error: e.message }); await store.waLog({ firmId, to, kind: meta.kind, error: e.message }); }
  }
  return { configured: configured(), sent: results.length, results, preview: text };
}
module.exports = { broadcast, configured, normalize };

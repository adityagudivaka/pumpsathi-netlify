'use strict';
const { schedule } = require('@netlify/functions');
const cron = require('../../lib/cron');

// Runs every 15 minutes (UTC). The cron logic converts to IST for send-times.
module.exports.handler = schedule('*/15 * * * *', async () => {
  try { await cron.run(); } catch (e) { console.error('[alerts-cron]', e); }
  return { statusCode: 200 };
});

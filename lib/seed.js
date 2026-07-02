'use strict';
const bcrypt = require('bcryptjs');
const store = require('./store');
const { KV_KEYS } = require('./collections');
const config = require('./config');
const data = require('./seed-data');

const DEFAULT_ALERTS = {
  enabled: true, recipients: [],
  types: {
    dailySales: { on: true, time: '21:30' },
    compliance: { on: true, daysAhead: 30 },
    outstandingCredit: { on: true, threshold: 0 },
    weeklyAttendance: { on: true, weekday: 1 },
  },
};

async function seedFirm(firmId) {
  for (const coll of ['products', 'nozzles', 'staff', 'customers', 'oils', 'compliance']) {
    for (const rec of (data[coll] || [])) await store.insert(firmId, coll, rec);
  }
  for (const k of KV_KEYS) {
    if (k === 'alerts') await store.kvSet(firmId, 'alerts', DEFAULT_ALERTS);
    else if (data[k] !== undefined) await store.kvSet(firmId, k, data[k]);
  }
}

let _booted = null;
async function ensureBootstrap() {
  if (_booted) return _booted;
  _booted = (async () => {
    if ((await store.userCount()) === 0) {
      const firm = await store.createFirm(config.ownerFirmName, 'AFS');
      await seedFirm(firm.id);
      await store.createUser(config.ownerMobile, 'Owner', bcrypt.hashSync(config.ownerPassword, 10), 'owner', firm.id);
    }
  })();
  return _booted;
}
module.exports = { ensureBootstrap, seedFirm, DEFAULT_ALERTS };

'use strict';
/*
 * Schema definitions for every normalized "list" collection.
 * Each collection becomes a table:
 *   id TEXT PK, firm_id TEXT, <these columns>, created_at, updated_at.
 * Types: 'num' -> REAL (blank/undefined -> NULL), 'int' -> INTEGER, 'text' -> TEXT.
 * Singletons (station, payroll, settings, expenseCategories, attendance, alerts)
 * live in the kv table, scoped per firm.
 */
const COLLECTIONS = {
  products:      { code: 'text', name: 'text', price: 'num', cost: 'num', tanks: 'text' },
  nozzles:       { dispenser: 'text', nozzle: 'text', product: 'text' },
  staff:         { name: 'text', role: 'text', salary: 'num', phone: 'text', joinDate: 'text', status: 'text' },
  customers:     { name: 'text', type: 'text', opening: 'num', limit: 'num', phone: 'text' },
  oils:          { name: 'text', price: 'num', qty: 'num' },
  priceLog:      { date: 'text', ms: 'num', hsd: 'num' },
  dailySales:    {
    date: 'text', boy: 'text', pump: 'text', prod: 'text', open: 'num', close: 'num', test: 'num',
    bpe1: 'num', bpe2: 'num', phonepe: 'num', bphonepe1: 'num', bphonepe2: 'num',
    paytm1: 'num', paytm2: 'num', ongo1: 'num', ongo2: 'num', cr: 'num', exp: 'num',
  },
  crDaily:       { date: 'text', twoTCash: 'num', custCash: 'num', yDeposit: 'num', tDeposit: 'num' },
  credit:        { date: 'text', customer: 'text', particulars: 'text', given: 'num', paid: 'num', mode: 'text' },
  oilSales:      { date: 'text', name: 'text', qty: 'num', value: 'num' },
  oilPurchases:  { date: 'text', name: 'text', qty: 'num', value: 'num' },
  advances:      { staffId: 'text', date: 'text', amount: 'num' },
  fuelStock:     { date: 'text', product: 'text', openingDip: 'num', physicalDip: 'num', remarks: 'text' },
  fuelPurchases: {
    date: 'text', invoiceNo: 'text', product: 'text', invoiceQty: 'num', rate: 'num',
    dipBefore: 'num', dipAfter: 'num', received: 'num', density: 'num', temp: 'num', remarks: 'text',
  },
  expenses:      { date: 'text', category: 'text', description: 'text', amount: 'num', mode: 'text', paidTo: 'text' },
  tanker:        { date: 'text', depot: 'text', product: 'text', qty: 'num', freight: 'num', vehicle: 'text', remarks: 'text' },
  cashBank:      { date: 'text', cashRecd: 'num', bpe: 'num', ppe: 'num', gpay: 'num', ptm: 'num', ong: 'num', card: 'num', adj: 'num', deposited: 'num' },
  compliance:    { item: 'text', authority: 'text', number: 'text', issue: 'text', expiry: 'text' },
};

// Singletons stored as JSON in the kv table (per firm)
const KV_KEYS = ['station', 'payroll', 'settings', 'expenseCategories', 'attendance', 'alerts'];

// Which collections are "master data" (kept when clearing transactional data)
const MASTER = new Set(['products', 'nozzles', 'staff', 'customers', 'oils', 'compliance']);

module.exports = { COLLECTIONS, KV_KEYS, MASTER };

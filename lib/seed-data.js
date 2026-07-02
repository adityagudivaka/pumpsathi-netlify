'use strict';
// Bare master data (no transactions) — mirrors the AFS workbook Setup + Engine Oils + Compliance sheets.
module.exports = {
  station: { name: 'Aditya Filling Station', dealer: '', omc: '', code: '', gstin: '', address: '' },
  settings: { openingCash: 0, msCommission: 4, hsdCommission: 3, oilMarginPct: 8 },
  payroll: { standardDays: 30, otRate: 50, hoursPerDay: 8 },
  expenseCategories: ['Electricity', 'DG / Diesel for genset', 'Salaries', 'Repairs & Maintenance', 'Cleaning / Consumables', 'Bank charges', 'Rent / Lease', 'Licenses & Fees', 'Freight / Tanker', 'Tea & Refreshments', 'Stationery', 'Misc'],
  products: [
    { code: 'MS', name: 'Petrol (MS)', price: 118.28, cost: 107.06, tanks: 'T1' },
    { code: 'HSD', name: 'Diesel (HSD)', price: 105.91, cost: 95.9, tanks: 'T2, T3' },
  ],
  nozzles: [
    { dispenser: 'M1', nozzle: 'N1', product: 'MS' }, { dispenser: 'M1', nozzle: 'N2', product: 'MS' },
    { dispenser: 'M2', nozzle: 'N1', product: 'MS' }, { dispenser: 'M2', nozzle: 'N2', product: 'HSD' },
    { dispenser: 'M2', nozzle: 'N3', product: 'HSD' }, { dispenser: 'M2', nozzle: 'N4', product: 'MS' },
    { dispenser: 'T1', nozzle: 'N1', product: 'HSD' }, { dispenser: 'T1', nozzle: 'N2', product: 'HSD' },
    { dispenser: 'T2', nozzle: 'N1', product: 'HSD' }, { dispenser: 'T2', nozzle: 'N2', product: 'HSD' },
    { dispenser: 'T2', nozzle: 'N3', product: 'MS' }, { dispenser: 'T2', nozzle: 'N4', product: 'MS' },
  ],
  staff: [
    { name: 'Sai Ramanjaneyulu', role: 'Pump Boy', salary: 20000, phone: '', status: 'Active' },
    { name: 'Naga Malleswara Rao', role: 'Pump Boy', salary: 15000, phone: '', status: 'Active' },
    { name: 'Naga Raju', role: 'Pump Boy', salary: 12000, phone: '', status: 'Active' },
    { name: 'Naresh', role: 'Pump Boy', salary: 12000, phone: '', status: 'Active' },
    { name: 'Naga Babu', role: 'Pump Boy', salary: 12000, phone: '', status: 'Active' },
    { name: 'Sudhakar', role: 'Pump Boy', salary: 12000, phone: '', status: 'Active' },
    { name: 'Krishna', role: 'Pump Boy', salary: 10000, phone: '', status: 'Active' },
    { name: 'Raja Rao', role: 'Pump Boy', salary: 10000, phone: '', status: 'Active' },
    { name: 'Kotaiah', role: 'Cleaner', salary: 3500, phone: '', status: 'Active' },
  ],
  customers: ['Sivalayam', 'Sampath', 'N/P Kiran', 'KG Rao', 'Car Siva', 'Sitaramaiah', 'Panchayathi', 'Ravindra Babu', 'Balaram', 'Machine Saradhi', 'Naveen', 'Durga Prasad', 'P/L Chiranjeevi', 'D.Siva', 'U/P Veera Babu', 'Bala Bhanu', 'R.Rajesh', 'M.G.Prasad', 'Uday', 'Krishna Prasad', 'Ch.Sambaiah', 'Mende V Rao', 'ONGC SES', 'JCB Sai', 'Lorry Venu', 'Lorry Siva', 'Lorry Chintapandu', 'Meka A/R', 'V.Palli K.Veera Raghavaiah']
    .map((name) => ({ name, type: 'Regular', opening: 0, limit: 0, phone: '' })),
  oils: [
    { name: 'Servo 20W/40 1/2L', price: 150, qty: 31 }, { name: 'Servo 20W/40 1L', price: 305, qty: 40 },
    { name: 'Servo 20W/40 5L', price: 1450, qty: 15 }, { name: 'Servo 4T 900ML', price: 330, qty: 52 },
    { name: 'Servo 4T 1L', price: 365, qty: 40 }, { name: 'Pump set 3.5L', price: 910, qty: 11 },
    { name: 'Servo CREA 90HP 5L', price: 1570, qty: 3 }, { name: 'Servo CREA 140HP 5L', price: 1750, qty: 2 },
    { name: 'Servo 15W140 1L', price: 330, qty: 10 }, { name: 'Servo 15W140 5L', price: 1620, qty: 7 },
    { name: 'Servo 2T 1/2L', price: 180, qty: 10 }, { name: 'Activa Grease KG', price: 225, qty: 1 },
    { name: 'Battery Water 1L', price: 35, qty: 75 },
  ],
  compliance: ['Explosives (PESO) Licence', 'Trade Licence', 'Weights & Measures Stamping', 'Fire NOC', 'Pollution (CTO)', 'GST Registration', 'Electrical Safety']
    .map((item) => ({ item, authority: '', number: '', issue: '', expiry: '' })),
  attendance: {},
};

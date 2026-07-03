'use strict';
/*
 * Role-based access control. Areas are coarse module groups; every collection
 * and kv key maps to an area. Writes are enforced at the API; the UI hides what
 * a role can't use. Firm (pump) isolation is separate (JWT firmId).
 */
const AREAS = ['sales', 'credit', 'stock', 'cash', 'expenses', 'attendance', 'compliance', 'shifts', 'setup', 'alerts', 'users', 'pumps', 'audit'];

// what each role may EDIT ('*' = everything)
const ROLE_EDIT = {
  owner: '*',
  admin: ['sales', 'credit', 'stock', 'cash', 'expenses', 'attendance', 'compliance', 'shifts', 'setup', 'alerts', 'users', 'audit'],
  manager: ['sales', 'credit', 'stock', 'cash', 'expenses', 'attendance', 'compliance', 'shifts'],
  cashier: ['sales', 'cash', 'credit', 'shifts'],
  attendant: ['sales', 'shifts'],
  inventory: ['stock', 'shifts'],
  accountant: ['cash', 'expenses', 'credit', 'compliance'],
  auditor: [], // read-only everywhere + can view audit
};
const ROLES = Object.keys(ROLE_EDIT);
const ROLE_LABELS = { owner: 'Owner', admin: 'Pump Admin', manager: 'Manager', cashier: 'Cashier', attendant: 'Attendant', inventory: 'Inventory', accountant: 'Accountant', auditor: 'Auditor' };
const VIEW_ALL = new Set(['owner', 'admin', 'auditor']);

function canEdit(role, area) { const e = ROLE_EDIT[role]; return e === '*' ? true : Array.isArray(e) && e.includes(area); }
function canView(role, area) {
  if (area === 'audit') return ['owner', 'admin', 'auditor'].includes(role);
  if (area === 'pumps' || area === 'users') return canEdit(role, area) || (area === 'users' && role === 'auditor');
  if (VIEW_ALL.has(role)) return true;
  return canEdit(role, area);
}
function editableAreas(role) { return ROLE_EDIT[role] === '*' ? AREAS.slice() : (ROLE_EDIT[role] || []).slice(); }
function viewableAreas(role) { return AREAS.filter((a) => canView(role, a)); }

// collection -> area
const COLLECTION_AREA = {
  dailySales: 'sales', crDaily: 'sales', priceLog: 'sales',
  credit: 'credit', customers: 'credit',
  oils: 'stock', oilSales: 'stock', oilPurchases: 'stock', fuelStock: 'stock', fuelPurchases: 'stock', tanker: 'stock',
  cashBank: 'cash', expenses: 'expenses',
  staff: 'setup', products: 'setup', nozzles: 'setup', advances: 'attendance',
  compliance: 'compliance', shifts: 'shifts',
};
// kv key -> area
const KV_AREA = { station: 'setup', payroll: 'setup', settings: 'setup', expenseCategories: 'setup', attendance: 'attendance', alerts: 'alerts' };

module.exports = { AREAS, ROLES, ROLE_LABELS, canEdit, canView, editableAreas, viewableAreas, COLLECTION_AREA, KV_AREA };

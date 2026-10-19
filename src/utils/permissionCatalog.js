const PERMISSION_ACTIONS = ['view', 'create', 'edit', 'approve', 'cancel', 'delete', 'export']

const PERMISSION_MODULES = [
  'dashboard', 'inventory', 'purchases', 'sales', 'expenses', 'loans', 'transfers',
  'production', 'venues', 'reports', 'settings', 'organization', 'users',
  'stock_movements', 'search', 'quality', 'audit', 'finance', 'notifications',
]

const ALL_ACTIONS = [...PERMISSION_ACTIONS]

function permission(module, actions = ALL_ACTIONS) {
  return { module, actions }
}

function operationPermissions(modules, actions = ALL_ACTIONS) {
  return modules.map((module) => permission(module, actions))
}

const BUILTIN_ROLE_TEMPLATES = [
  {
    code: 'administrator',
    name: 'Administrator',
    description: 'Full access to the business, its branches, users, and records.',
    permissions: operationPermissions(PERMISSION_MODULES),
  },
  {
    code: 'manager',
    name: 'Manager',
    description: 'Oversees daily operations, approvals, reports, and branch activity.',
    permissions: [
      ...operationPermissions(['dashboard', 'inventory', 'purchases', 'sales', 'expenses', 'loans', 'transfers', 'production', 'venues', 'reports', 'stock_movements', 'search', 'quality', 'finance']),
      permission('organization', ['view']),
      permission('users', ['view']),
    ],
  },
  {
    code: 'storekeeper',
    name: 'Storekeeper',
    description: 'Controls stock, warehouse operations, and inventory movement records.',
    permissions: [
      permission('dashboard', ['view']),
      permission('inventory', ['view', 'create', 'edit', 'export']),
      permission('stock_movements', ['view', 'create', 'edit', 'export']),
      permission('purchases', ['view']),
      permission('venues', ['view', 'create', 'edit']),
      permission('search', ['view']),
      permission('organization', ['view']),
    ],
  },
  {
    code: 'production_supervisor',
    name: 'Production Supervisor',
    description: 'Plans production, records outputs, and completes quality handoffs.',
    permissions: [
      permission('dashboard', ['view']),
      permission('production', ALL_ACTIONS),
      permission('quality', ['view', 'create', 'edit']),
      permission('inventory', ['view']),
      permission('stock_movements', ['view', 'create']),
      permission('reports', ['view', 'export']),
      permission('search', ['view']),
      permission('organization', ['view']),
    ],
  },
  {
    code: 'procurement_officer',
    name: 'Procurement Officer',
    description: 'Manages purchasing, suppliers, and incoming inventory.',
    permissions: [
      permission('dashboard', ['view']),
      permission('purchases', ALL_ACTIONS),
      permission('inventory', ['view', 'create', 'edit']),
      permission('venues', ['view']),
      permission('reports', ['view', 'export']),
      permission('search', ['view']),
      permission('organization', ['view']),
    ],
  },
  {
    code: 'quality_officer',
    name: 'Quality Officer',
    description: 'Reviews production quality and verifies compliance records.',
    permissions: [
      permission('dashboard', ['view']),
      permission('production', ['view', 'approve', 'export']),
      permission('quality', ['view', 'create', 'edit', 'approve', 'export']),
      permission('inventory', ['view']),
      permission('reports', ['view', 'export']),
      permission('search', ['view']),
      permission('organization', ['view']),
    ],
  },
  {
    code: 'cashier',
    name: 'Cashier',
    description: 'Records sales and customer payments at assigned branches.',
    permissions: [
      permission('dashboard', ['view']),
      permission('sales', ['view', 'create', 'edit']),
      permission('finance', ['view', 'create']),
      permission('inventory', ['view']),
      permission('transfers', ['view', 'create', 'edit']),
      permission('search', ['view']),
      permission('organization', ['view']),
    ],
  },
  {
    code: 'accountant',
    name: 'Accountant',
    description: 'Maintains expenses, loans, financial records, and reports.',
    permissions: [
      permission('dashboard', ['view']),
      permission('expenses', ALL_ACTIONS),
      permission('loans', ALL_ACTIONS),
      permission('purchases', ['view', 'approve', 'export']),
      permission('sales', ['view', 'export']),
      permission('reports', ALL_ACTIONS),
      permission('finance', ALL_ACTIONS),
      permission('settings', ['view']),
      permission('search', ['view']),
      permission('organization', ['view']),
    ],
  },
]

const DEFAULT_ROLE_BY_SHOP_ROLE = {
  cashier: 'cashier',
  sales_associate: 'cashier',
  customer_service_representative: 'cashier',
  stock_clerk: 'storekeeper',
  visual_merchandiser: 'storekeeper',
  loss_prevention_officer: 'storekeeper',
  shift_supervisor: 'manager',
  assistant_store_manager: 'manager',
  store_manager: 'manager',
}

function normalizePermissionModule(value) {
  const module = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return PERMISSION_MODULES.includes(module) ? module : ''
}

function normalizePermissionActions(actions) {
  return [...new Set((Array.isArray(actions) ? actions : [])
    .map((action) => String(action || '').trim().toLowerCase())
    .filter((action) => PERMISSION_ACTIONS.includes(action)))]
}

function defaultRoleCodeForUser(user = {}) {
  if (String(user.role || '').toLowerCase() === 'admin') return 'administrator'
  return DEFAULT_ROLE_BY_SHOP_ROLE[user.shopRole] || 'cashier'
}

module.exports = {
  ALL_ACTIONS,
  BUILTIN_ROLE_TEMPLATES,
  DEFAULT_ROLE_BY_SHOP_ROLE,
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  defaultRoleCodeForUser,
  normalizePermissionActions,
  normalizePermissionModule,
}

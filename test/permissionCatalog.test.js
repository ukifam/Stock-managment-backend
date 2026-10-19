const assert = require('node:assert/strict')
const test = require('node:test')

const {
  BUILTIN_ROLE_TEMPLATES,
  defaultRoleCodeForUser,
  normalizePermissionActions,
  normalizePermissionModule,
} = require('../src/utils/permissionCatalog')
const { actionForRequest } = require('../src/middleware/shopFeatureMiddleware')

test('built-in operational roles cover every required business role', () => {
  const codes = new Set(BUILTIN_ROLE_TEMPLATES.map((role) => role.code))
  for (const code of ['administrator', 'manager', 'storekeeper', 'production_supervisor', 'procurement_officer', 'quality_officer', 'cashier', 'accountant']) {
    assert.equal(codes.has(code), true)
  }
})

test('permission catalog normalizes supported modules and actions', () => {
  assert.equal(normalizePermissionModule('Stock Movements'), 'stock_movements')
  assert.equal(normalizePermissionModule('unknown'), '')
  assert.deepEqual(normalizePermissionActions(['VIEW', 'delete', 'delete', 'invalid']), ['view', 'delete'])
  assert.equal(defaultRoleCodeForUser({ role: 'staff', shopRole: 'stock_clerk' }), 'storekeeper')
})

test('quality officers can record and approve inspections while cashiers cannot access quality', () => {
  const qualityOfficer = BUILTIN_ROLE_TEMPLATES.find((role) => role.code === 'quality_officer')
  const cashier = BUILTIN_ROLE_TEMPLATES.find((role) => role.code === 'cashier')
  assert.deepEqual(qualityOfficer.permissions.find((entry) => entry.module === 'quality').actions, ['view', 'create', 'edit', 'approve', 'export'])
  assert.equal(cashier.permissions.some((entry) => entry.module === 'quality'), false)
})

test('route action mapping distinguishes views, approvals, changes, and deletion', () => {
  assert.equal(actionForRequest({ method: 'GET', path: '/', query: {} }), 'view')
  assert.equal(actionForRequest({ method: 'GET', path: '/export', query: {} }), 'export')
  assert.equal(actionForRequest({ method: 'POST', path: '/SO-1/status', body: { status: 'APPROVED' }, query: {} }), 'approve')
  assert.equal(actionForRequest({ method: 'PATCH', path: '/SO-1', body: { status: 'CANCELLED' }, query: {} }), 'cancel')
  assert.equal(actionForRequest({ method: 'DELETE', path: '/SO-1', body: {}, query: {} }), 'delete')
})

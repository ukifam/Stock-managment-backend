const test = require('node:test')
const assert = require('node:assert/strict')
const { applyPermissionOverrides } = require('../src/services/accessRoleService')

const cashier = [
  { module: 'sales', actions: ['view', 'create', 'edit'] },
  { module: 'inventory', actions: ['view'] },
]

test('without overrides the role permissions are returned unchanged', () => {
  assert.deepEqual(applyPermissionOverrides(cashier, [], []), cashier)
})

test('grants add new pages and actions', () => {
  const result = applyPermissionOverrides(cashier, [{ module: 'reports', actions: ['view'] }, { module: 'sales', actions: ['delete'] }], [])
  assert.deepEqual(result.find((p) => p.module === 'reports').actions, ['view'])
  assert.deepEqual(result.find((p) => p.module === 'sales').actions, ['view', 'create', 'edit', 'delete'])
})

test('revokes remove actions and drop pages left empty', () => {
  const result = applyPermissionOverrides(cashier, [], [{ module: 'inventory', actions: ['view'] }, { module: 'sales', actions: ['edit'] }])
  assert.equal(result.find((p) => p.module === 'inventory'), undefined)
  assert.deepEqual(result.find((p) => p.module === 'sales').actions, ['view', 'create'])
})

test('unknown modules and actions are ignored', () => {
  const result = applyPermissionOverrides(cashier, [{ module: 'hacking', actions: ['view'] }, { module: 'sales', actions: ['fly'] }], [])
  assert.deepEqual(result, cashier)
})

const assert = require('node:assert/strict')
const test = require('node:test')

const accessRoleModelPath = require.resolve('../src/models/AccessRole')
const rows = []

const AccessRole = {
  bulkWrite: async (operations) => {
    operations.forEach(({ updateOne }) => {
      const { ownerKey, code } = updateOne.filter
      if (!rows.some((row) => row.ownerKey === ownerKey && row.code === code)) {
        rows.push({ ...updateOne.update.$setOnInsert, ...updateOne.update.$set })
      }
    })
  },
  findOne: (filter) => ({
    lean: async () => rows.find((row) => (
      row.ownerKey === filter.ownerKey
      && row.code === filter.code
      && (filter.active?.$ne !== false || row.active !== false)
    )) || null,
  }),
}

require.cache[accessRoleModelPath] = {
  id: accessRoleModelPath,
  filename: accessRoleModelPath,
  loaded: true,
  exports: AccessRole,
}

const { hasPermission } = require('../src/services/accessRoleService')
const { runWithTenant } = require('../src/utils/tenantContext')

test('staff access roles allow only their assigned module actions', async () => {
  await runWithTenant({
    id: 'cashier-1',
    username: 'Cashier One',
    role: 'staff',
    ownerKey: 'permission-test',
    ownerEmail: 'owner@example.test',
    branchCode: 'MAIN',
  }, async () => {
    const user = { role: 'staff', accessRoleCode: 'cashier', shopRole: 'cashier' }
    assert.equal(await hasPermission(user, 'sales', 'create'), true)
    assert.equal(await hasPermission(user, 'inventory', 'create'), false)
    assert.equal(await hasPermission(user, 'reports', 'export'), false)
  })
})

test('business administrators retain unrestricted operational access', async () => {
  await runWithTenant({ role: 'admin', ownerKey: 'permission-test', branchCode: 'MAIN' }, async () => {
    assert.equal(await hasPermission({ role: 'admin' }, 'inventory', 'delete'), true)
  })
})

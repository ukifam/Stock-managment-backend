const assert = require('node:assert/strict')
const test = require('node:test')

const { branchScopedQuery, runWithTenant, withBranchFields } = require('../src/utils/tenantContext')

test('branch scoped queries include the selected business and branch', () => {
  runWithTenant({
    id: 'user-1',
    role: 'admin',
    ownerKey: 'kivu-cafe',
    ownerEmail: 'owner@kivu.test',
    email: 'operator@kivu.test',
    username: 'Kivu Owner',
    branchCode: 'kigali',
  }, () => {
    assert.deepEqual(branchScopedQuery({ sku: 'COFFEE-01' }), {
      $and: [
        { ownerKey: 'kivu-cafe' },
        { branchCode: 'KIGALI' },
        { sku: 'COFFEE-01' },
      ],
    })
    assert.deepEqual(withBranchFields({ sku: 'COFFEE-01' }), {
      sku: 'COFFEE-01',
      ownerKey: 'kivu-cafe',
      ownerEmail: 'owner@kivu.test',
      branchCode: 'KIGALI',
      createdBy: { id: 'user-1', username: 'Kivu Owner', email: 'operator@kivu.test' },
      updatedBy: { id: 'user-1', username: 'Kivu Owner', email: 'operator@kivu.test' },
    })
  })
})

test('main branch retains access to legacy records without a branch code', () => {
  runWithTenant({
    role: 'admin',
    ownerKey: 'legacy',
    ownerEmail: 'info@ukifam.com',
    branchCode: 'MAIN',
  }, () => {
    const query = branchScopedQuery({ id: 'INV-1' })
    assert.deepEqual(query.$and[1], {
      $or: [
        { branchCode: 'MAIN' },
        { branchCode: { $exists: false } },
        { branchCode: '' },
        { branchCode: null },
      ],
    })
    assert.deepEqual(query.$and[2], { id: 'INV-1' })
  })
})

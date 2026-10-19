const assert = require('node:assert/strict')
const test = require('node:test')

const storeModelPath = require.resolve('../src/models/storeModel')
const loanModelPath = require.resolve('../src/models/Loan')
const transferModelPath = require.resolve('../src/models/PartnerTransfer')
const store = {
  inventory: [
    { item: 'Available Item', sku: 'SKU-A', stock: 2, capacity: 10 },
    { item: 'Empty Item', sku: 'SKU-E', stock: 0, capacity: 8 },
  ],
  sales: [{ id: 'SO-1', date: new Date().toISOString().slice(0, 10), item: 'Available Item', value: 120, customer: 'Client', status: 'Completed' }],
  purchases: [],
  expenses: [],
  settings: { inventory: { lowStockThreshold: 3 }, financial: { currency: 'RWF' } },
}

require.cache[storeModelPath] = {
  id: storeModelPath,
  filename: storeModelPath,
  loaded: true,
  exports: {
    readStore: async () => store,
    tenantFilter: () => ({ ownerKey: 'shop-owner' }),
    StockMovement: { find: () => ({ sort() { return this }, limit() { return this }, lean: async () => [{ _id: 'MOV-1', type: 'SALE', sku: 'SKU-A', date: '2026-10-01', quantity: -1, reason: 'Sale', user: 'Cashier' }] }) },
  },
}
require.cache[loanModelPath] = {
  id: loanModelPath,
  filename: loanModelPath,
  loaded: true,
  exports: { find: () => ({ sort() { return this }, limit() { return this }, lean: async () => [{ id: 'LN-1', type: 'GIVEN', status: 'ACTIVE', partyName: 'Borrower', principalAmount: 50, startDate: '2026-10-01' }] }) },
}
require.cache[transferModelPath] = {
  id: transferModelPath,
  filename: transferModelPath,
  loaded: true,
  exports: { find: () => ({ sort() { return this }, limit() { return this }, lean: async () => [{ _id: 'TR-1', reference: 'TR-1', item: 'Partner Item', partner: 'Partner', status: 'OPEN', quantityReceived: 2, quantitySold: 0, quantityReturned: 0, receivedDate: '2026-10-01' }] }) },
}

const { createBusiness, getAdminOverview } = require('../src/services/adminService')
const { adminMiddleware } = require('../src/middleware/adminMiddleware')
const User = require('../src/models/User')
const Business = require('../src/models/Business')

test('admin overview summarizes tenant activity and provides operational destinations', async () => {
  const overview = await getAdminOverview()

  assert.equal(overview.metrics.inventoryItems, 2)
  assert.equal(overview.metrics.lowStockCount, 1)
  assert.equal(overview.metrics.outOfStockCount, 1)
  assert.equal(overview.metrics.salesToday, 1)
  assert.equal(overview.metrics.openLoans, 1)
  assert.equal(overview.metrics.openTransfers, 1)
  assert.ok(overview.activity.some((entry) => entry.section === 'sales' && entry.reference === 'SO-1'))
  assert.ok(overview.activity.some((entry) => entry.section === 'stock-movements' && entry.actor === 'Cashier'))
})

test('admin middleware permits system administrators and rejects other users', () => {
  let nextCalled = false
  adminMiddleware({ user: { role: 'system_admin' } }, {}, () => { nextCalled = true })
  assert.equal(nextCalled, true)

  let denied
  adminMiddleware({ user: { role: 'admin' } }, {}, (error) => { denied = error })
  assert.equal(denied.status, 403)
})

test('system administrators can create a business with a processing owner account', async () => {
  const originalUserMethods = { findOne: User.findOne, create: User.create, deleteOne: User.deleteOne }
  const originalBusinessMethods = { findOne: Business.findOne, create: Business.create }
  let createdUser
  let createdBusiness
  User.findOne = async () => null
  User.create = async (payload) => {
    createdUser = payload
    return { _id: { toString: () => 'user-id' } }
  }
  User.deleteOne = async () => ({ deletedCount: 1 })
  Business.findOne = async () => null
  Business.create = async (payload) => {
    createdBusiness = payload
    return { ...payload, _id: { toString: () => 'business-id' } }
  }

  try {
    const result = await createBusiness({
      businessName: 'Hilltop Mill',
      username: 'Business Owner',
      email: 'owner@example.com',
      password: 'secure-password',
      template: 'maize_mill',
      processingEnabled: true,
    })

    assert.equal(result.name, 'Hilltop Mill')
    assert.equal(result.ownerKey, 'owner@example.com')
    assert.equal(result.processingEnabled, true)
    assert.equal(createdUser.role, 'admin')
    assert.equal(createdUser.ownerKey, 'owner@example.com')
    assert.notEqual(createdUser.password, 'secure-password')
    assert.equal(createdBusiness.name, 'Hilltop Mill')
    assert.equal(createdBusiness.template, 'maize_mill')
  } finally {
    Object.assign(User, originalUserMethods)
    Object.assign(Business, originalBusinessMethods)
  }
})

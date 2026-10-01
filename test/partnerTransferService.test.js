const assert = require('node:assert/strict')
const test = require('node:test')

const transferModelPath = require.resolve('../src/models/PartnerTransfer')
const storeModelPath = require.resolve('../src/models/storeModel')
const transfers = []
const stockMovements = []
const store = {
  inventory: [{ sku: 'OWN-1', item: 'Owned Product', category: 'General', stock: 10, capacity: 20, price: 500 }],
  purchases: [],
  sales: [],
  expenses: [],
  settings: { financial: { currency: 'RWF' } },
}

function cloneTransfer(row) {
  return { ...row, sales: [...(row.sales || [])], toObject() { return cloneTransfer({ ...this, toObject: undefined }) } }
}

const PartnerTransfer = {
  create: async (payload) => {
    const row = { _id: `TR-${transfers.length + 1}`, status: 'OPEN', quantitySold: 0, quantityReturned: 0, ...payload, sales: [] }
    transfers.push(row)
    return cloneTransfer(row)
  },
  find: (filter = {}) => ({
    sort() { return this },
    lean: async () => transfers.filter((row) => !filter.status || row.status === filter.status).map((row) => ({ ...row, sales: [...row.sales] })),
  }),
  findOneAndUpdate: async (filter, update) => {
    const row = transfers.find((entry) => entry._id === filter._id && (!filter.status || entry.status === filter.status))
    if (!row) return null
    const increment = update.$inc || {}
    const soldAfter = row.quantitySold + Number(increment.quantitySold || 0)
    const returnedAfter = row.quantityReturned + Number(increment.quantityReturned || 0)
    const quantityDelta = Number(increment.quantitySold || increment.quantityReturned || 0)
    if (quantityDelta && soldAfter + returnedAfter > row.quantityReceived) return null
    Object.entries(increment).forEach(([key, value]) => { row[key] = Number(row[key] || 0) + Number(value) })
    if (update.$set) Object.assign(row, update.$set)
    if (update.$push?.sales) row.sales.push(update.$push.sales)
    if (update.$push?.returns) row.returns = [...(row.returns || []), update.$push.returns]
    return cloneTransfer(row)
  },
  updateOne: async (filter, update) => {
    const row = transfers.find((entry) => entry._id === filter._id && (!filter.status || entry.status === filter.status))
    if (!row) return { modifiedCount: 0 }
    Object.entries(update.$inc || {}).forEach(([key, value]) => { row[key] = Number(row[key] || 0) + Number(value) })
    if (update.$set) Object.assign(row, update.$set)
    return { modifiedCount: 1 }
  },
}

require.cache[transferModelPath] = { id: transferModelPath, filename: transferModelPath, loaded: true, exports: PartnerTransfer }
require.cache[storeModelPath] = {
  id: storeModelPath,
  filename: storeModelPath,
  loaded: true,
  exports: {
    readStore: async () => store,
    writeStore: async () => undefined,
    tenantFilter: () => ({}),
    scopedQuery: (query) => query,
    withTenantFields: (record) => record,
    StockMovement: { create: async (movement) => { stockMovements.push(movement); return movement } },
  },
}

const service = require('../src/services/partnerTransferService')
const { computeMatchedGrossProfit } = require('../src/utils/profitCalculator')

 test('partner transfer stock stays separate; sales record cost and returns close outstanding units', async () => {
  const transfer = await service.receivePartnerStock({
    partner: 'Partner Shop',
    item: 'Partner Camera',
    sku: 'PARTNER-CAM-1',
    quantityReceived: 4,
    partnerUnitCost: 400,
    customerUnitPrice: 650,
  })

  assert.equal(store.inventory[0].stock, 10)
  assert.equal(transfer.remainingQuantity, 4)

  await service.sellTransferredStock(transfer._id, { quantity: 2, customer: 'Client A', payment: 'Cash' })
  assert.equal(store.sales.length, 1)
  assert.equal(store.sales[0].customer, 'Client A')
  assert.equal(store.sales[0].value, 1300)
  assert.equal(store.sales[0].items[0].costBasis, 400)
  assert.equal(store.inventory[0].stock, 10)

  const afterReturn = await service.returnTransferredStock(transfer._id, { quantity: 1 })
  assert.equal(afterReturn.remainingQuantity, 1)
  assert.equal(afterReturn.returns[0].quantity, 1)
  assert.equal(store.inventory[0].stock, 10)

  const finalSale = await service.sellTransferredStock(transfer._id, { quantity: 1, customer: 'Client B', payment: 'Cash' })
  assert.equal(finalSale.transfer.status, 'CLOSED')
  assert.equal(finalSale.transfer.remainingQuantity, 0)
  assert.equal(store.inventory[0].stock, 10)

  const profit = computeMatchedGrossProfit(store.sales, new Map(), store.inventory, [])
  assert.equal(profit.costOfGoodsSold, 1200)
  assert.equal(profit.grossProfit, 750)
})

test('cannot sell or return beyond the unallocated partner quantity', async () => {
  const transfer = await service.receivePartnerStock({
    partner: 'Second Shop',
    item: 'Partner Lens',
    quantityReceived: 1,
    partnerUnitCost: 100,
    customerUnitPrice: 180,
  })
  await assert.rejects(service.sellTransferredStock(transfer._id, { quantity: 2, customer: 'Client' }), /not have enough available quantity/)
  await assert.rejects(service.returnTransferredStock(transfer._id, { quantity: 2 }), /not have enough available quantity to return/)
})

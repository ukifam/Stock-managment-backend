const assert = require('node:assert/strict')
const test = require('node:test')

const storeModelPath = require.resolve('../src/models/storeModel')
const store = {
  inventory: [{ sku: 'SKU-SHOW-1', item: 'Demo Camera', category: 'Cameras', stock: 5, capacity: 10, price: 800 }],
  purchases: [],
  sales: [],
  expenses: [],
  settings: { financial: { currency: 'RWF' } },
}
const movements = []
const stockMovementModel = {
  create: async (movement) => {
    const created = { _id: `MOV-${movements.length + 1}`, ...movement }
    movements.push(created)
    return created
  },
  find: (filter = {}) => {
    let rows = [...movements]
    if (filter.reference) rows = rows.filter((movement) => movement.reference === filter.reference)
    if (filter.type?.$in) rows = rows.filter((movement) => filter.type.$in.includes(movement.type))
    return {
      sort() { return this },
      lean: async () => rows,
    }
  },
}

require.cache[storeModelPath] = {
  id: storeModelPath,
  filename: storeModelPath,
  loaded: true,
  exports: {
    readStore: async () => store,
    writeStore: async () => undefined,
    withTenantFields: (record) => record,
    scopedQuery: (query) => query,
    tenantFilter: () => ({}),
    StockMovement: stockMovementModel,
  },
}

const stockMovementService = require('../src/services/stockMovementService')

test('showcase issue, partial return, and partner sale preserve stock and sales records', async () => {
  const issue = await stockMovementService.sendToShowcase({
    sku: 'SKU-SHOW-1',
    quantity: 3,
    partner: 'Partner Shop',
    expectedReturnDate: '2026-10-10',
  })

  assert.equal(store.inventory[0].stock, 2)
  assert.equal(issue.type, 'SHOWCASE_OUT')

  let openCases = await stockMovementService.listOpenShowcases()
  assert.equal(openCases.length, 1)
  assert.equal(openCases[0].remainingQuantity, 3)
  assert.equal(openCases[0].partner, 'Partner Shop')

  await stockMovementService.closeShowcase(issue.reference, {
    outcome: 'RETURNED',
    quantity: 1,
  })

  assert.equal(store.inventory[0].stock, 3)
  openCases = await stockMovementService.listOpenShowcases()
  assert.equal(openCases[0].remainingQuantity, 2)

  const sale = await stockMovementService.closeShowcase(issue.reference, {
    outcome: 'SOLD',
    quantity: 2,
    unitPrice: 950,
    payment: 'Credit',
    paidAmount: 0,
  })

  assert.equal(sale.customer, 'Partner Shop')
  assert.equal(sale.reference, issue.reference)
  assert.equal(sale.value, 'RWF 1,900')
  assert.equal(store.sales.length, 1)
  assert.equal(store.inventory[0].stock, 3)
  assert.equal(movements.at(-1).type, 'SHOWCASE_SALE')
  assert.equal(movements.at(-1).quantity, 0)
  assert.equal(movements.at(-1).showcaseQuantity, 2)
  assert.deepEqual(await stockMovementService.listOpenShowcases(), [])
})

test('showcase issue rejects a quantity above current stock', async () => {
  await assert.rejects(
    stockMovementService.sendToShowcase({ sku: 'SKU-SHOW-1', quantity: 99, partner: 'Partner Shop' }),
    /Only 3 units are in stock/,
  )
})

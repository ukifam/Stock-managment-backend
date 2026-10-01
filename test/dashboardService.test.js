const assert = require('node:assert/strict')
const test = require('node:test')

const storeModelPath = require.resolve('../src/models/storeModel')
const store = {
  inventory: [
    { item: 'Keyboard', sku: 'K-1', category: 'Electronics', stock: 5, capacity: 10, price: 20, date: '2026-09-01' },
    { item: 'Notebook', sku: 'N-1', category: 'Office', stock: 0, capacity: 8, price: 4, date: '2026-09-02' },
    { item: 'Monitor', sku: 'M-1', category: 'Electronics', stock: 50, capacity: 100, price: 200, date: '2026-09-03' },
  ],
  sales: [
    { date: '2026-09-29', value: 100 },
    { date: '2026-10-01', value: 250 },
  ],
  purchases: [
    { date: '2026-09-29', quantity: 2, unitPrice: 20 },
    { date: '2026-10-01', quantity: 1, unitPrice: 30 },
  ],
  settings: { inventory: { lowStockThreshold: 10 }, financial: { currency: 'RWF' } },
}

require.cache[storeModelPath] = {
  id: storeModelPath,
  filename: storeModelPath,
  loaded: true,
  exports: { readStore: async () => store },
}

const { getDashboard } = require('../src/services/dashboardService')

test('dashboard applies date, category, and stock filters', async () => {
  const all = await getDashboard()
  assert.equal(all.metrics[1].value, 'RWF 350')
  assert.equal(all.salesBars.length, 12)
  assert.equal(all.salesLabels.length, 6)

  const dateFiltered = await getDashboard({ from: '2026-10-01', to: '2026-10-01' })
  assert.equal(dateFiltered.metrics[1].value, 'RWF 250')
  assert.equal(dateFiltered.metrics[1].delta, '1 orders')

  const categoryFiltered = await getDashboard({ category: 'Electronics' })
  assert.equal(categoryFiltered.metrics[0].value, '2')

  const outOfStock = await getDashboard({ stockStatus: 'out' })
  assert.equal(outOfStock.metrics[0].value, '1')
  assert.equal(outOfStock.lowStock.length, 1)
})
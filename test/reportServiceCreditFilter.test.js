const assert = require('node:assert/strict')
const test = require('node:test')

const storeModelPath = require.resolve('../src/models/storeModel')
const store = {
  inventory: [{ sku: 'SKU-1', item: 'Test item', stock: 5, price: 30 }],
  sales: [
    { date: '2026-01-03', sku: 'SKU-1', item: 'Test item', quantity: 1, value: 100, payment: 'Cash' },
    { date: '2026-01-04', sku: 'SKU-1', item: 'Test item', quantity: 1, value: 200, payment: 'Credit' },
  ],
  purchases: [
    { date: '2026-01-01', sku: 'SKU-1', item: 'Test item', quantity: 1, unitPrice: 20, payment: 'Cash' },
    { date: '2026-01-02', sku: 'SKU-1', item: 'Test item', quantity: 1, unitPrice: 30, payment: 'Credit' },
  ],
  expenses: [{ date: '2026-01-05', amount: 10, description: 'Operating cost' }],
  settings: { financial: { currency: 'RWF' } },
}

require.cache[storeModelPath] = {
  id: storeModelPath,
  filename: storeModelPath,
  loaded: true,
  exports: { readStore: async () => store },
}

const { getReports } = require('../src/services/reportService')
const dateRange = { from: '2026-01-01', to: '2026-01-31' }

test('sales credit filter narrows rows without changing the full-period summary', async () => {
  const response = await getReports({ ...dateRange, credit: 'salesCredit' })

  assert.equal(response.summary.totalSales, 'RWF 300')
  assert.equal(response.summary.totalSalesOnCredit, 'RWF 200')
  assert.equal(response.summary.salesCount, 2)
  assert.equal(response.summary.grossProfit, 'RWF 250')
  assert.equal(response.summary.netProfit, 'RWF 240')
  assert.equal(response.detailSales.length, 1)
  assert.equal(response.detailSales[0].payment, 'Credit')
})

test('purchase credit filter narrows rows without changing the full-period summary', async () => {
  const response = await getReports({ ...dateRange, credit: 'purchasesCredit' })

  assert.equal(response.summary.totalPurchases, 'RWF 50')
  assert.equal(response.summary.totalPurchasesOnCredit, 'RWF 30')
  assert.equal(response.summary.purchasesCount, 2)
  assert.equal(response.summary.totalSales, 'RWF 300')
  assert.equal(response.summary.grossProfit, 'RWF 250')
  assert.equal(response.detailPurchases.length, 1)
  assert.equal(response.detailPurchases[0].payment, 'Credit')
})
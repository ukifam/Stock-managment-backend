const test = require('node:test')
const assert = require('node:assert/strict')
const { computeMatchedGrossProfit } = require('../src/utils/profitCalculator')

test('uses prior purchases to calculate gross profit for a later period', () => {
  const purchaseCostIndex = new Map()
  const purchases = [
    { date: '2026-06-15', sku: 'SKU-1', quantity: 10, unitPrice: 100 },
  ]
  const sales = [
    { date: '2026-07-01', sku: 'SKU-1', quantity: 5, value: 600 },
  ]

  const result = computeMatchedGrossProfit(sales, purchaseCostIndex, [], purchases)

  assert.equal(result.grossProfit, 100)
  assert.equal(result.costOfGoodsSold, 500)
})

test('does not use purchases from after the sale date', () => {
  const purchaseCostIndex = new Map()
  const purchases = [
    { date: '2026-07-10', sku: 'SKU-1', quantity: 5, unitPrice: 100 },
    { date: '2026-08-10', sku: 'SKU-1', quantity: 10, unitPrice: 50 },
  ]
  const sales = [
    { date: '2026-07-15', sku: 'SKU-1', quantity: 8, value: 600 },
  ]

  const result = computeMatchedGrossProfit(sales, purchaseCostIndex, [], purchases)

  assert.equal(result.grossProfit, 100)
  assert.equal(result.costOfGoodsSold, 500)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const { computeMatchedGrossProfit, calculateSaleCostDetails } = require('../src/utils/profitCalculator')

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

test('calculates the purchase cost and unit cost for a single sale', () => {
  const purchaseCostIndex = new Map()
  const purchases = [
    { date: '2026-06-10', sku: 'SKU-1', quantity: 10, unitPrice: 120 },
  ]
  const sale = { date: '2026-06-20', sku: 'SKU-1', quantity: 4, value: 600 }

  const result = calculateSaleCostDetails(sale, purchases, purchaseCostIndex, [])

  assert.equal(result.totalCost, 480)
  assert.equal(result.unitCost, 120)
})

test('uses inventory price when there is no matching purchase entry', () => {
  const purchaseCostIndex = new Map()
  const inventory = [{ sku: 'SKU-1', item: 'Test Item', price: 150 }]
  const sale = { date: '2026-06-20', sku: 'SKU-1', quantity: 4, value: 600 }

  const result = calculateSaleCostDetails(sale, [], purchaseCostIndex, inventory)

  assert.equal(result.totalCost, 600)
  assert.equal(result.unitCost, 150)
})

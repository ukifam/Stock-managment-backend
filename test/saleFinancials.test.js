const test = require('node:test')
const assert = require('node:assert/strict')
const { calculateSaleFinancials, normalizePaymentMethod } = require('../src/services/saleService')

test('sale totals calculate subtotal, discount, tax, cost of goods, profit, and margin', () => {
  assert.deepEqual(calculateSaleFinancials([
    { total: 100, costOfGoodsSold: 60 },
    { total: 50, costOfGoodsSold: 20 },
  ], 10, 7), {
    subtotal: 150,
    discount: 10,
    tax: 7,
    total: 147,
    netRevenue: 140,
    costOfGoodsSold: 80,
    grossProfit: 60,
    grossMarginPercent: 42.8571,
  })
})

test('sale financials reject invalid discount and tax amounts', () => {
  assert.throws(() => calculateSaleFinancials([{ total: 10, costOfGoodsSold: 2 }], 11, 0), /Discount/)
  assert.throws(() => calculateSaleFinancials([{ total: 10, costOfGoodsSold: 2 }], 0, -1), /Tax/)
})

test('sale payment methods normalize all required tender types and reject unsupported methods', () => {
  assert.equal(normalizePaymentMethod('cash'), 'Cash')
  assert.equal(normalizePaymentMethod('CARD'), 'Card')
  assert.equal(normalizePaymentMethod('mobile_money'), 'Mobile Money')
  assert.equal(normalizePaymentMethod('credit'), 'Credit')
  assert.throws(() => normalizePaymentMethod('crypto'), /Payment method/)
})

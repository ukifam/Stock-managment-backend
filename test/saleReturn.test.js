const assert = require('node:assert/strict')
const test = require('node:test')
const { validateSaleReturnItems } = require('../src/services/saleService')

const saleItems = [
  { sku: 'SKU-1', item: 'Widget', quantity: 5 },
  { sku: 'SKU-2', item: 'Gadget', quantity: 2 },
]

test('sale return validation aggregates duplicate lines and reserves pending returns', () => {
  const result = validateSaleReturnItems('SO-1', saleItems, [
    { status: 'Pending', items: [{ sku: 'SKU-1', item: 'Widget', quantity: 2 }] },
    { status: 'Rejected', items: [{ sku: 'SKU-1', item: 'Widget', quantity: 1 }] },
  ], [
    { sku: 'SKU-1', quantity: 1 },
    { sku: 'SKU-1', quantity: 2 },
  ])
  assert.deepEqual(result, [{ sku: 'SKU-1', item: 'Widget', quantity: 3 }])
})

test('sale return validation rejects unknown items, non-positive quantities, and over-returns', () => {
  assert.throws(
    () => validateSaleReturnItems('SO-1', saleItems, [], [{ sku: 'UNKNOWN', quantity: 1 }]),
    /not part of sale/,
  )
  assert.throws(
    () => validateSaleReturnItems('SO-1', saleItems, [], [{ sku: 'SKU-1', quantity: 0 }]),
    /greater than zero/,
  )
  assert.throws(
    () => validateSaleReturnItems('SO-1', saleItems, [
      { status: 'Pending', items: [{ sku: 'SKU-1', quantity: 4 }] },
    ], [{ sku: 'SKU-1', quantity: 2 }]),
    /remaining quantity/,
  )
})

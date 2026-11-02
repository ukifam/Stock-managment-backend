const test = require('node:test')
const assert = require('node:assert/strict')
const { escapeRegex, findInventoryItem, inventoryStatus, isSellableStatus } = require('../src/utils/inventoryMatch')
const { purchaseBaseUnitCost, purchaseTotal } = require('../src/utils/profitCalculator')

const inventory = [
  { sku: 'CHOC-1', item: 'Milk Chocolate' },
  { sku: 'MILK-1', item: 'Milk' },
  { sku: 'BREAD-1', item: 'White Bread' },
  { sku: 'BREAD-2', item: 'Brown Bread' },
]

test('findInventoryItem prefers exact sku, then exact name', () => {
  assert.equal(findInventoryItem(inventory, { sku: 'milk-1', item: 'Milk Chocolate' }).sku, 'MILK-1')
  assert.equal(findInventoryItem(inventory, { item: 'milk' }).sku, 'MILK-1')
})

test('findInventoryItem only accepts an unambiguous partial match', () => {
  assert.equal(findInventoryItem(inventory, { item: 'White Bread Loaf' }).sku, 'BREAD-1')
  assert.equal(findInventoryItem(inventory, { item: 'Bread' }), undefined)
  assert.equal(findInventoryItem(inventory, { item: '' }), undefined)
})

test('inventoryStatus uses the item reorder level before capacity', () => {
  assert.equal(inventoryStatus(0, {}), 'Out of Stock')
  assert.equal(inventoryStatus(8, { reorderLevel: 10 }), 'Low')
  assert.equal(inventoryStatus(8, { capacity: 100 }), 'Low')
  assert.equal(inventoryStatus(30, { capacity: 100 }), 'Active')
  assert.equal(inventoryStatus(3, {}), 'Active')
})

test('low stock items stay sellable', () => {
  assert.equal(isSellableStatus('Low'), true)
  assert.equal(isSellableStatus('Inactive'), false)
})

test('escapeRegex neutralises special characters', () => {
  assert.doesNotThrow(() => new RegExp(escapeRegex('(milk')))
  assert.equal(new RegExp(escapeRegex('a.b')).test('axb'), false)
})

test('purchase totals use the purchase unit, not the converted base quantity', () => {
  const purchase = { quantity: 100, originalQuantity: 2, unitPrice: 30000 }
  assert.equal(purchaseTotal(purchase), 60000)
  assert.equal(purchaseBaseUnitCost(purchase), 600)
  assert.equal(purchaseBaseUnitCost({ ...purchase, inventoryPrice: 550 }), 550)
  assert.equal(purchaseTotal({ quantity: 3, unitPrice: 10 }), 30)
})

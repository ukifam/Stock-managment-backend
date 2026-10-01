const assert = require('node:assert/strict')
const test = require('node:test')

const storeModelPath = require.resolve('../src/models/storeModel')
const loanModelPath = require.resolve('../src/models/Loan')
const transferModelPath = require.resolve('../src/models/PartnerTransfer')
const inventory = [{ sku: 'SKU-1', item: 'Needle Inventory', category: 'Tools' }]
const movements = [{ _id: 'MOVE-1', sku: 'SKU-1', type: 'ADJUSTMENT', reason: 'Needle count' }]
const store = {
  inventory,
  purchases: [{ id: 'PO-1', item: 'Needle Purchase', supplier: 'Supply Co', date: '2026-10-01' }],
  sales: [{ id: 'SO-1', item: 'Needle Sale', customer: 'Customer', date: '2026-10-01' }],
  expenses: [{ id: 'EX-1', description: 'Needle Expense', vendor: 'Vendor', date: '2026-10-01' }],
  settings: { financial: { currency: 'RWF' } },
}

require.cache[storeModelPath] = {
  id: storeModelPath,
  filename: storeModelPath,
  loaded: true,
  exports: {
    readStore: async () => store,
    StockMovement: { find: () => ({ lean: async () => movements }) },
  },
}
require.cache[loanModelPath] = {
  id: loanModelPath,
  filename: loanModelPath,
  loaded: true,
  exports: { find: () => ({ lean: async () => [{ id: 'LN-1', type: 'GIVEN', status: 'ACTIVE', partyName: 'Needle Borrower', purpose: 'Needle loan' }] }) },
}
require.cache[transferModelPath] = {
  id: transferModelPath,
  filename: transferModelPath,
  loaded: true,
  exports: { find: () => ({ lean: async () => [{ reference: 'TR-1', item: 'Needle Transfer Item', partner: 'Partner', status: 'OPEN', quantityReceived: 1, quantitySold: 0, quantityReturned: 0 }] }) },
}

const { searchAll } = require('../src/services/searchService')

test('global search returns matches across all active business data areas', async () => {
  const response = await searchAll('needle')

  assert.deepEqual(new Set(response.results.map((row) => row.type)), new Set([
    'Inventory',
    'Purchase',
    'Sale',
    'Expense',
    'Loan',
    'Transfer',
    'Stock Movement',
  ]))
  assert.equal(response.count, 7)
  assert.equal(response.results.find((row) => row.type === 'Stock Movement')?.page, 'stock-movements')
})

test('global search ignores queries shorter than two characters', async () => {
  assert.deepEqual(await searchAll(' '), { results: [], count: 0 })
})
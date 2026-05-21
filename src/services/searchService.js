const storeModel = require('../models/storeModel')
const { searchRows } = require('../utils/filters')
const { inventoryDto, purchaseDto, saleDto } = require('../utils/formatters')

async function searchAll(query = '') {
  const store = await storeModel.readStore()
  return {
    inventory: searchRows(store.inventory, query).map(inventoryDto),
    purchases: searchRows(store.purchases, query).map(purchaseDto),
    sales: searchRows(store.sales, query).map(saleDto),
  }
}

async function searchInventory(query = '') {
  const store = await storeModel.readStore()
  const results = searchRows(store.inventory, query).map(inventoryDto)
  return { rows: results, count: results.length }
}

module.exports = {
  searchAll,
  searchInventory,
}

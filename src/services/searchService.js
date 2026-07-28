const storeModel = require('../models/storeModel')
const { searchRows } = require('../utils/filters')
const { inventoryDto, purchaseDto, saleDto } = require('../utils/formatters')
const { currencyFromSettings } = require('../utils/settings')

async function searchAll(query = '') {
  const store = await storeModel.readStore()
  const currency = currencyFromSettings(store.settings)
  return {
    inventory: searchRows(store.inventory, query).map((row) => inventoryDto(row, currency)),
    purchases: searchRows(store.purchases, query).map((row) => purchaseDto(row, currency)),
    sales: searchRows(store.sales, query).map((row) => saleDto(row, currency)),
  }
}

async function searchInventory(query = '') {
  const store = await storeModel.readStore()
  const currency = currencyFromSettings(store.settings)
  const results = searchRows(store.inventory, query).map((row) => inventoryDto(row, currency))
  return { rows: results, count: results.length }
}

module.exports = {
  searchAll,
  searchInventory,
}

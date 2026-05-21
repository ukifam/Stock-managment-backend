const storeModel = require('../models/storeModel')
const httpError = require('../utils/httpError')
const { filterByPeriod, searchRows } = require('../utils/filters')
const { inventoryDto } = require('../utils/formatters')
const { parseMoney, parseQuantity } = require('../utils/parsers')
const { required } = require('../utils/validation')

async function listInventory({ period = 'yearly', search = '' }) {
  const store = await storeModel.readStore()
  const rows = searchRows(filterByPeriod(store.inventory, period), search)
  return { rows: rows.map(inventoryDto), count: rows.length }
}

async function getInventoryItem(sku) {
  const store = await storeModel.readStore()
  const item = store.inventory.find((row) => row.sku === sku)
  if (!item) throw httpError(404, 'Inventory item not found')
  return inventoryDto(item)
}

async function createInventoryItem(body) {
  const missing = required(body, ['item', 'sku', 'category'])
  if (missing.length) throw httpError(400, 'Missing required fields', { fields: missing })

  const store = await storeModel.readStore()
  if (store.inventory.some((item) => item.sku === body.sku)) {
    throw httpError(409, 'SKU already exists')
  }

  const item = {
    date: body.date || new Date().toISOString().slice(0, 10),
    item: body.item,
    meta: body.meta || body.brand || 'Manual entry',
    sku: body.sku,
    category: body.category,
    stock: parseQuantity(body.stock ?? body.quantity, 1),
    capacity: parseQuantity(body.capacity, 25),
    price: parseMoney(body.price ?? body.unitPrice, 0),
    status: body.status || 'Active',
    serial: body.serial || body.serialNumber || '',
    supplier: body.supplier || '',
    shelfLocation: body.shelfLocation || '',
    leadTime: body.leadTime || '',
    warranty: body.warranty || '',
  }

  store.inventory.unshift(item)
  await storeModel.writeStore(store)
  return inventoryDto(item)
}

async function updateInventoryItem(sku, body) {
  const store = await storeModel.readStore()
  const index = store.inventory.findIndex((row) => row.sku === sku)
  if (index === -1) throw httpError(404, 'Inventory item not found')

  store.inventory[index] = {
    ...store.inventory[index],
    ...body,
    stock: body.stock !== undefined ? parseQuantity(body.stock, store.inventory[index].stock) : store.inventory[index].stock,
    capacity: body.capacity !== undefined ? parseQuantity(body.capacity, store.inventory[index].capacity) : store.inventory[index].capacity,
    price: body.price !== undefined ? parseMoney(body.price, store.inventory[index].price) : store.inventory[index].price,
  }

  await storeModel.writeStore(store)
  return inventoryDto(store.inventory[index])
}

module.exports = {
  listInventory,
  getInventoryItem,
  createInventoryItem,
  updateInventoryItem,
}

const storeModel = require('../models/storeModel')
const httpError = require('../utils/httpError')
const { filterByPeriod, searchRows } = require('../utils/filters')
const { saleDto } = require('../utils/formatters')
const { parseMoney, parseQuantity } = require('../utils/parsers')
const { required } = require('../utils/validation')

async function listSales({ period = 'yearly', search = '' }) {
  const store = await storeModel.readStore()
  const rows = searchRows(filterByPeriod(store.sales, period), search)
  return { rows: rows.map(saleDto), count: rows.length }
}

async function createSale(body) {
  const missing = required(body, ['customer', 'item'])
  if (missing.length) throw httpError(400, 'Missing required fields', { fields: missing })

  const store = await storeModel.readStore()
  const sale = {
    date: body.date || new Date().toISOString().slice(0, 10),
    id: body.id || `SO-${Date.now().toString().slice(-6)}`,
    customer: body.customer,
    phone: body.phone || '',
    item: body.item,
    sku: body.sku || '',
    category: body.category || 'Uncategorized',
    quantity: parseQuantity(body.quantity ?? body.items, 1),
    value: parseMoney(body.value ?? body.total, 0),
    payment: body.payment || 'Credit',
    status: body.status || 'Given',
  }

  applySaleToInventory(store, sale)
  store.sales.unshift(sale)
  await storeModel.writeStore(store)
  return saleDto(sale)
}

async function updateSaleStatus(id, status) {
  const store = await storeModel.readStore()
  const index = store.sales.findIndex((sale) => sale.id === id)
  if (index === -1) throw httpError(404, 'Sale not found')

  store.sales[index] = {
    ...store.sales[index],
    status,
  }

  await storeModel.writeStore(store)
  return saleDto(store.sales[index])
}

async function getAvailableItems() {
  const store = await storeModel.readStore()
  const availableItems = store.inventory
    .filter((item) => Number(item.stock || 0) > 0 && item.status === 'Active')
    .map((item) => ({
      sku: item.sku,
      item: item.item,
      category: item.category,
      stock: Number(item.stock || 0),
      price: Number(item.price || 0),
    }))
    .sort((a, b) => a.item.localeCompare(b.item))

  return { items: availableItems }
}

module.exports = {
  listSales,
  getAvailableItems,
  createSale,
  updateSaleStatus,
}

function applySaleToInventory(store, sale) {
  const existing = findInventoryItem(store.inventory, sale)
  if (!existing) throw httpError(404, 'Inventory item not found for this sale')

  const currentStock = Number(existing.stock || 0)
  const saleQuantity = Number(sale.quantity || 0)

  if (saleQuantity > currentStock) {
    throw httpError(400, `Only ${currentStock} units are available in stock`)
  }

  existing.stock = currentStock - saleQuantity
  existing.status = inventoryStatus(existing.stock)
}

function findInventoryItem(inventory, entry) {
  const sku = String(entry.sku || '').trim().toLowerCase()
  const item = String(entry.item || '').trim().toLowerCase()

  return inventory.find((row) => {
    const rowSku = String(row.sku || '').trim().toLowerCase()
    const rowItem = String(row.item || '').trim().toLowerCase()
    return (sku && rowSku === sku) || (!sku && item && rowItem === item)
  })
}

function inventoryStatus(stock) {
  const count = Number(stock || 0)
  if (count <= 0) return 'Out of Stock'
  if (count <= 5) return 'Low'
  return 'Active'
}

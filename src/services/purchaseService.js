const storeModel = require('../models/storeModel')
const httpError = require('../utils/httpError')
const { filterByPeriod, searchRows } = require('../utils/filters')
const { purchaseDto } = require('../utils/formatters')
const { parseMoney, parseQuantity } = require('../utils/parsers')
const { required } = require('../utils/validation')

async function listPurchases({ period = 'yearly', search = '' }) {
  const store = await storeModel.readStore()
  const rows = searchRows(filterByPeriod(store.purchases, period), search)
  return { rows: rows.map(purchaseDto), count: rows.length }
}

async function createPurchase(body) {
  const missing = required(body, ['supplier', 'item'])
  if (missing.length) throw httpError(400, 'Missing required fields', { fields: missing })

  const store = await storeModel.readStore()
  const purchase = {
    date: body.date || new Date().toISOString().slice(0, 10),
    id: body.id || `PO-${Date.now().toString().slice(-6)}`,
    supplier: body.supplier,
    phone: body.phone || '',
    item: body.item,
    sku: body.sku || '',
    category: body.category || 'Uncategorized',
    quantity: parseQuantity(body.quantity, 1),
    unitPrice: parseMoney(body.unitPrice ?? body.price, 0),
    status: body.status || 'Received',
  }

  store.purchases.unshift(purchase)
  applyPurchaseToInventory(store, purchase)
  await storeModel.writeStore(store)
  return purchaseDto(purchase)
}

async function updatePurchaseStatus(id, status) {
  const store = await storeModel.readStore()
  const index = store.purchases.findIndex((purchase) => purchase.id === id)
  if (index === -1) throw httpError(404, 'Purchase not found')

  store.purchases[index] = {
    ...store.purchases[index],
    status,
  }

  await storeModel.writeStore(store)
  return purchaseDto(store.purchases[index])
}

module.exports = {
  listPurchases,
  createPurchase,
  updatePurchaseStatus,
}

function applyPurchaseToInventory(store, purchase) {
  const existing = findInventoryItem(store.inventory, purchase)

  if (existing) {
    existing.stock = Number(existing.stock || 0) + Number(purchase.quantity || 0)
    existing.capacity = Math.max(Number(existing.capacity || 0), Number(existing.stock || 0))
    existing.price = Number(purchase.unitPrice || existing.price || 0)
    existing.status = inventoryStatus(existing.stock)
    return
  }

  store.inventory.unshift({
    date: purchase.date,
    item: purchase.item,
    meta: 'Added from purchase',
    sku: purchase.sku || `SKU-${Date.now().toString().slice(-6)}`,
    category: purchase.category || 'Uncategorized',
    stock: Number(purchase.quantity || 0),
    capacity: Math.max(Number(purchase.quantity || 0), 25),
    price: Number(purchase.unitPrice || 0),
    status: inventoryStatus(purchase.quantity),
    serial: '',
    supplier: purchase.supplier,
    shelfLocation: '',
    leadTime: '',
    warranty: '',
  })
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

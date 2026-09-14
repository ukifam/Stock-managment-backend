const storeModel = require('../models/storeModel')
const httpError = require('../utils/httpError')
const { filterByPeriod, filterByRange, searchRows } = require('../utils/filters')
const { saleDto } = require('../utils/formatters')
const { currencyFromSettings } = require('../utils/settings')
const { parseMoney, parseQuantity } = require('../utils/parsers')
const { formatDocumentId } = require('../utils/idFormatter')
const { required } = require('../utils/validation')
const CacheManager = require('../utils/cache')
const stockMovementService = require('./stockMovementService')

/**
 * List sales with pagination, filtering, and caching
 */
async function listSales({ period = 'yearly', search = '', page = 1, limit = 50, status = '', from = '', to = '' }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1)
  const limitNum = Math.min(1000, Math.max(1, parseInt(limit, 10) || 50))

  const cacheKey = `sales:list:${period}:${from}:${to}:${search}:${pageNum}:${limitNum}:${status}`
  const cached = CacheManager.get(cacheKey)
  if (cached) {
    return cached
  }

  const store = await storeModel.readStore()
  let rows = from || to ? filterByRange(store.sales, from, to) : filterByPeriod(store.sales, period)

  if (status) {
    rows = rows.filter((row) => row.status.toLowerCase() === status.toLowerCase())
  }

  if (search) {
    rows = searchRows(rows, search)
  }

  const totalCount = rows.length
  const totalPages = Math.ceil(totalCount / limitNum)
  const skip = (pageNum - 1) * limitNum
  const paginatedRows = rows.slice(skip, skip + limitNum)

  const currency = currencyFromSettings(store.settings)
  const result = {
    rows: paginatedRows.map((row) => saleDto(row, currency)),
    count: totalCount,
    page: pageNum,
    pageSize: limitNum,
    totalPages,
    hasNextPage: pageNum < totalPages,
    hasPrevPage: pageNum > 1,
  }

  CacheManager.set(cacheKey, result, 60000)
  return result
}

async function createSale(body) {
  if (!body.customer) {
    throw httpError(400, 'Customer name is required')
  }

  // Normalize items array
  let saleItems = []
  if (Array.isArray(body.items) && body.items.length > 0) {
    saleItems = body.items.map((it) => ({
      sku: String(it.sku || '').trim(),
      item: String(it.item || '').trim(),
      category: String(it.category || 'General').trim(),
      quantity: Math.max(1, parseInt(it.quantity, 10) || 1),
      unitPrice: Math.max(0, parseFloat(it.unitPrice) || 0),
      total: Math.max(0, (parseInt(it.quantity, 10) || 1) * (parseFloat(it.unitPrice) || 0)),
    }))
  } else if (body.item) {
    const qty = Math.max(1, parseInt(body.quantity, 10) || 1)
    const val = parseFloat(body.value ?? body.total) || 0
    const price = body.unitPrice ? parseFloat(body.unitPrice) : (qty ? val / qty : 0)
    saleItems = [
      {
        sku: String(body.sku || '').trim(),
        item: String(body.item || '').trim(),
        category: String(body.category || 'General').trim(),
        quantity: qty,
        unitPrice: price,
        total: val || qty * price,
      },
    ]
  } else {
    throw httpError(400, 'At least one sale item is required')
  }

  const store = await storeModel.readStore()

  // Verify stock availability for ALL items before deducting anything
  const inventoryItemsToUpdate = []
  for (const sItem of saleItems) {
    const invItem = findInventoryItem(store.inventory, sItem)
    if (!invItem) {
      throw httpError(404, `Product not found in inventory: ${sItem.item || sItem.sku}`)
    }
    const currentStock = Number(invItem.stock || 0)
    if (sItem.quantity > currentStock) {
      throw httpError(400, `Insufficient stock for ${invItem.item} (SKU: ${invItem.sku}). Requested: ${sItem.quantity}, Available: ${currentStock}`)
    }
    sItem.sku = invItem.sku
    sItem.item = invItem.item
    sItem.category = invItem.category || sItem.category
    inventoryItemsToUpdate.push({ invItem, saleItem: sItem, prevStock: currentStock })
  }

  // Deduct stock
  for (const { invItem, saleItem, prevStock } of inventoryItemsToUpdate) {
    invItem.stock = prevStock - saleItem.quantity
    invItem.status = inventoryStatus(invItem.stock)
  }

  const subtotal = saleItems.reduce((sum, it) => sum + it.total, 0)
  const discount = Math.max(0, parseFloat(body.discount) || 0)
  const tax = Math.max(0, parseFloat(body.tax) || 0)
  const total = Math.max(0, subtotal - discount + tax)
  const payment = body.payment || 'Cash'
  const paidAmount = resolvePaidAmount(body, total, payment, total)
  const outstanding = resolveOutstanding(body, total, paidAmount, payment, Math.max(0, total - paidAmount))

  const date = body.date || new Date().toISOString().slice(0, 10)
  let id = String(body.id || body.saleid || '').trim() || formatDocumentId('SO', { ...body, date }, new Date())
  while (store.sales.some((sale) => sale.id === id)) {
    id = `${id}-${Math.random().toString(36).slice(2, 6)}`
  }

  const summaryItemText = saleItems.length === 1
    ? saleItems[0].item
    : `${saleItems.length} items (${saleItems.map((i) => `${i.item} × ${i.quantity}`).join(', ').slice(0, 50)}...)`

  const sale = {
    date,
    id,
    customer: body.customer,
    phone: body.phone || body.contact || '',
    item: summaryItemText,
    sku: saleItems[0]?.sku || '',
    category: saleItems[0]?.category || 'General',
    extractedText: body.extractedText || '',
    quantity: saleItems.reduce((sum, it) => sum + it.quantity, 0),
    subtotal,
    discount,
    tax,
    value: total,
    payment,
    paidAmount,
    outstanding,
    status: body.status || saleStatus(payment, outstanding),
    items: saleItems,
  }

  store.sales.unshift(sale)
  await storeModel.writeStore(store)

  // Record individual stock movements for each item in the sale
  for (const { invItem, saleItem, prevStock } of inventoryItemsToUpdate) {
    await stockMovementService.recordMovement({
      date,
      sku: invItem.sku,
      type: 'SALE',
      quantity: -saleItem.quantity,
      previousStock: prevStock,
      newStock: invItem.stock,
      reason: `Sale ${id} to ${body.customer}: ${saleItem.quantity}x ${saleItem.item}`,
      reference: id,
      user: body.user || 'Cashier',
    })
  }

  CacheManager.clear()
  return saleDto(sale, currencyFromSettings(store.settings))
}

async function bulkImportSales(bodies) {
  if (!Array.isArray(bodies) || bodies.length === 0) {
    throw httpError(400, 'No rows to import')
  }

  const store = await storeModel.readStore()
  const currency = currencyFromSettings(store.settings)
  const created = []
  const failed = []

  bodies.forEach((body, index) => {
    const item = String(body.item || body.description || body.product || '').trim()
    const customer = String(body.customer || body.name || '').trim()
    if (!item || !customer) return

    try {
      const sale = buildSaleRecord({ ...body, item, customer }, store, index)
      applySaleToInventory(store, sale)
      store.sales.unshift(sale)
      created.push(sale)
    } catch (error) {
      failed.push({
        row: index + 1,
        item,
        message: error.message || 'Could not import sale row',
      })
    }
  })

  if (created.length === 0) {
    throw httpError(400, failed[0]?.message || 'No valid sale rows were found in the file', { failed })
  }

  await storeModel.writeStore(store)
  CacheManager.clear()

  return {
    count: created.length,
    skipped: bodies.length - created.length - failed.length,
    failed: failed.length,
    rows: created.slice(0, 50).map((row) => saleDto(row, currency)),
  }
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

  // Clear caches after updating
  CacheManager.clear()

  return saleDto(store.sales[index], currencyFromSettings(store.settings))
}

async function updateSale(id, body) {
  const missing = required(body, ['customer', 'item'])
  if (missing.length) throw httpError(400, 'Missing required fields', { fields: missing })

  const store = await storeModel.readStore()
  const index = store.sales.findIndex((sale) => sale.id === id)
  if (index === -1) throw httpError(404, 'Sale not found')

  const previousSale = store.sales[index]
  const quantity = parseQuantity(body.quantity ?? body.items, previousSale.quantity)
  const value = parseMoney(body.value ?? body.total ?? previousSale.value, previousSale.value)
  const payment = body.payment || previousSale.payment || 'Cash'
  const paidAmount = resolvePaidAmount(body, value, payment, previousSale.paidAmount)
  const outstanding = resolveOutstanding(body, value, paidAmount, payment, previousSale.outstanding)

  const nextSale = {
    ...previousSale,
    date: body.date || previousSale.date,
    id: body.id || previousSale.id,
    customer: body.customer,
    phone: body.phone || '',
    item: body.item,
    sku: body.sku || previousSale.sku || '',
    category: body.category || previousSale.category || 'Uncategorized',
    extractedText: body.extractedText ?? previousSale.extractedText ?? '',
    quantity,
    value,
    payment,
    paidAmount,
    outstanding,
    status: body.status || saleStatus(payment, outstanding),
  }

  if (nextSale.id !== previousSale.id && store.sales.some((sale, saleIndex) => saleIndex !== index && sale.id === nextSale.id)) {
    throw httpError(409, 'Sale ID already exists')
  }

  removeSaleFromInventory(store, previousSale)
  store.sales[index] = nextSale
  applySaleToInventory(store, nextSale)
  await storeModel.writeStore(store)

  const existing = findInventoryItem(store.inventory, nextSale)
  if (existing) {
    await stockMovementService.recordMovement({
      date: nextSale.date,
      sku: existing.sku,
      type: 'ADJUSTMENT', // Treat as adjustment for update to keep simple
      quantity: -(nextSale.quantity - previousSale.quantity),
      previousStock: existing.stock + (nextSale.quantity - previousSale.quantity),
      newStock: existing.stock,
      reason: 'Sale updated',
      reference: nextSale.id
    })
  }

  // Clear caches after updating
  CacheManager.clear()

  return saleDto(nextSale, currencyFromSettings(store.settings))
}

/**
 * Get available items for sale with caching
 */
async function getAvailableItems() {
  // Check cache first
  const cacheKey = 'sales:available-items'
  const cached = CacheManager.get(cacheKey)
  if (cached) {
    return cached
  }

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

  const result = { items: availableItems }
  CacheManager.set(cacheKey, result, 60000)
  return result
}

module.exports = {
  listSales,
  getAvailableItems,
  createSale,
  bulkImportSales,
  updateSale,
  updateSaleStatus,
}

function buildSaleRecord(body, store, index = 0) {
  const quantity = parseQuantity(body.quantity ?? body.items, 1)
  const value = parseMoney(body.value ?? body.total, 0)
  const payment = body.payment || 'Cash'
  const paidAmount = resolvePaidAmount(body, value, payment)
  const outstanding = resolveOutstanding(body, value, paidAmount, payment)
  const requestedId = String(body.id || body.saleid || '').trim()
  let id = requestedId || formatDocumentId('SO', { ...body, date: body.date || new Date().toISOString().slice(0, 10) }, new Date())

  while (store.sales.some((sale) => sale.id === id)) {
    id = `${id}-${Math.random().toString(36).slice(2, 6)}`
  }

  return {
    date: body.date || new Date().toISOString().slice(0, 10),
    id,
    customer: body.customer,
    phone: body.phone || body.contact || '',
    item: body.item,
    sku: body.sku || body.barcode || '',
    category: body.category || 'Uncategorized',
    extractedText: body.extractedText || '',
    quantity,
    value,
    payment,
    paidAmount,
    outstanding,
    status: body.status || saleStatus(payment, outstanding),
  }
}

function removeSaleFromInventory(store, sale) {
  const existing = findInventoryItem(store.inventory, sale)
  if (!existing) return

  existing.stock = Number(existing.stock || 0) + Number(sale.quantity || 0)
  existing.status = inventoryStatus(existing.stock)
}

function applySaleToInventory(store, sale) {
  const existing = findInventoryItem(store.inventory, sale)
  if (!existing) throw httpError(404, 'Inventory item not found for this sale')

  const currentStock = Number(existing.stock || 0)
  const saleQuantity = Number(sale.quantity || 0)

  if (saleQuantity > currentStock) {
    throw httpError(400, `Only ${currentStock} units are available in stock`)
  }

  sale.sku = existing.sku || sale.sku
  sale.category = existing.category || sale.category
  sale.item = existing.item || sale.item
  existing.stock = currentStock - saleQuantity
  existing.status = inventoryStatus(existing.stock)
}

function findInventoryItem(inventory, entry) {
  const sku = normalizeText(entry.sku)
  const item = normalizeText(entry.item)

  return inventory.find((row) => {
    const rowSku = normalizeText(row.sku)
    const rowItem = normalizeText(row.item)
    return (sku && rowSku === sku) || itemMatches(rowItem, item)
  })
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ')
}

function itemMatches(rowItem, item) {
  if (!rowItem || !item) return false
  if (rowItem === item) return true
  return rowItem.includes(item) || item.includes(rowItem)
}

function inventoryStatus(stock) {
  const count = Number(stock || 0)
  if (count <= 0) return 'Out of Stock'
  if (count <= 5) return 'Low'
  return 'Active'
}

function isCreditPayment(payment) {
  return String(payment || '').toLowerCase() === 'credit'
}

function resolvePaidAmount(body, total, payment, fallback = 0) {
  if (body.paidAmount !== undefined && body.paidAmount !== null && body.paidAmount !== '') {
    return Math.min(total, Math.max(0, parseMoney(body.paidAmount, fallback)))
  }
  return isCreditPayment(payment) ? Math.min(total, Math.max(0, Number(fallback || 0))) : total
}

function resolveOutstanding(body, total, paidAmount, payment, fallback = 0) {
  if (body.outstanding !== undefined && body.outstanding !== null && body.outstanding !== '') {
    return Math.max(0, parseMoney(body.outstanding, fallback))
  }
  return isCreditPayment(payment) ? Math.max(0, total - paidAmount) : 0
}

function saleStatus(payment, outstanding) {
  if (isCreditPayment(payment) && outstanding > 0) return 'Pending'
  return 'Given'
}

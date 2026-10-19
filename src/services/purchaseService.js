const storeModel = require('../models/storeModel')
const httpError = require('../utils/httpError')
const { filterByPeriod, filterByRange, searchRows } = require('../utils/filters')
const { purchaseDto } = require('../utils/formatters')
const { currencyFromSettings } = require('../utils/settings')
const { parseMoney, parseQuantity } = require('../utils/parsers')
const { formatDocumentId, normalizeDocumentId } = require('../utils/idFormatter')
const { required } = require('../utils/validation')
const CacheManager = require('../utils/cache')
const stockMovementService = require('./stockMovementService')
const { convertItemQuantity, convertQuantity, normalizeUnitCode } = require('./unitConversionService')

/**
 * List purchases with pagination, filtering, and caching
 */
async function listPurchases({ period = 'yearly', search = '', page = 1, limit = 50, status = '', from = '', to = '' }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1)
  const limitNum = Math.min(1000, Math.max(1, parseInt(limit, 10) || 50))

  const cacheKey = `purchases:list:${period}:${from}:${to}:${search}:${pageNum}:${limitNum}:${status}`
  const cached = CacheManager.get(cacheKey)
  if (cached) {
    return cached
  }

  const store = await storeModel.readStore()
  let rows = from || to ? filterByRange(store.purchases, from, to) : filterByPeriod(store.purchases, period)

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
    rows: paginatedRows.map((row) => purchaseDto(row, currency)),
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

async function createPurchase(body) {
  const missing = required(body, ['item'])
  if (missing.length) throw httpError(400, 'Missing required fields', { fields: missing })

  const store = await storeModel.readStore()
  const purchase = buildPurchaseRecord(body, store, 0)
  await applyPurchaseUnitConversion(purchase, store, body)
  store.purchases.unshift(purchase)
  applyPurchaseToInventory(store, purchase)
  await storeModel.writeStore(store)

  const existing = findInventoryItem(store.inventory, purchase)
  if (existing) {
    await stockMovementService.recordMovement({
      date: purchase.date,
      sku: existing.sku,
      type: 'PURCHASE',
      quantity: purchase.quantity,
      previousStock: existing.stock - purchase.quantity,
      newStock: existing.stock,
      reason: 'Purchase received',
      reference: purchase.id,
      originalQuantity: purchase.originalQuantity,
      originalUnit: purchase.originalUnit,
      convertedQuantity: purchase.convertedQuantity,
      convertedUnit: purchase.convertedUnit,
      warehouseCode: purchase.warehouseCode,
      batchNumber: purchase.batchNumber,
      expiryDate: purchase.expiryDate,
    })
  }

  CacheManager.clear()

  return purchaseDto(purchase, currencyFromSettings(store.settings))
}

async function bulkImportPurchases(bodies) {
  if (!Array.isArray(bodies) || bodies.length === 0) {
    throw httpError(400, 'No rows to import')
  }

  const store = await storeModel.readStore()
  const currency = currencyFromSettings(store.settings)
  const created = []

  for (const [index, body] of bodies.entries()) {
    const item = String(body.item || body.description || body.product || '').trim()
    if (!item) continue

    const purchase = buildPurchaseRecord({ ...body, item }, store, index)
    await applyPurchaseUnitConversion(purchase, store, body)
    store.purchases.unshift(purchase)
    applyPurchaseToInventory(store, purchase)
    created.push(purchase)
  }

  if (created.length === 0) {
    throw httpError(400, 'No valid purchase rows were found in the file')
  }

  await storeModel.writeStore(store)
  for (const purchase of created) {
    const existing = findInventoryItem(store.inventory, purchase)
    if (!existing) continue
    await stockMovementService.recordMovement({
      date: purchase.date,
      sku: existing.sku,
      type: 'PURCHASE',
      quantity: purchase.quantity,
      previousStock: Number(existing.stock || 0) - Number(purchase.quantity || 0),
      newStock: Number(existing.stock || 0),
      reason: 'Imported purchase received',
      reference: purchase.id,
      originalQuantity: purchase.originalQuantity,
      originalUnit: purchase.originalUnit,
      convertedQuantity: purchase.convertedQuantity,
      convertedUnit: purchase.convertedUnit,
      warehouseCode: purchase.warehouseCode,
    })
  }
  CacheManager.clear()

  return {
    count: created.length,
    skipped: bodies.length - created.length,
    rows: created.slice(0, 50).map((row) => purchaseDto(row, currency)),
  }
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

  // Clear caches after updating
  CacheManager.clear()

  return purchaseDto(store.purchases[index], currencyFromSettings(store.settings))
}

async function updatePurchase(id, body) {
  const missing = required(body, ['item'])
  if (missing.length) throw httpError(400, 'Missing required fields', { fields: missing })

  const store = await storeModel.readStore()
  const index = store.purchases.findIndex((purchase) => purchase.id === id)
  if (index === -1) throw httpError(404, 'Purchase not found')

  const previousPurchase = store.purchases[index]
  const originalQuantity = parseQuantity(body.quantity, previousPurchase.originalQuantity || previousPurchase.quantity)
  const unitPrice = parseMoney(body.unitPrice ?? body.price, previousPurchase.unitPrice)
  const inventoryPrice = parseMoney(body.inventoryPrice, previousPurchase.inventoryPrice ?? unitPrice)
  const total = originalQuantity * unitPrice
  const payment = body.payment || previousPurchase.payment || 'Cash'
  const paidAmount = resolvePaidAmount(body, total, payment, previousPurchase.paidAmount)
  const outstanding = resolveOutstanding(body, total, paidAmount, payment, previousPurchase.outstanding)
  const nextPurchase = {
    ...previousPurchase,
    date: body.date || previousPurchase.date,
    id: body.id || previousPurchase.id,
    supplier: body.supplier || '',
    phone: body.phone || '',
    item: body.item,
    sku: body.sku || '',
    category: body.category || 'Uncategorized',
    extractedText: body.extractedText ?? previousPurchase.extractedText ?? '',
    quantity: originalQuantity,
    originalQuantity,
    originalUnit: body.unit || body.purchaseUnit || previousPurchase.originalUnit || '',
    unitPrice,
    inventoryPrice,
    payment,
    paidAmount,
    outstanding,
    status: body.status || purchaseStatus(payment, outstanding),
  }
  await applyPurchaseUnitConversion(nextPurchase, store, body)

  if (nextPurchase.id !== previousPurchase.id && store.purchases.some((purchase, purchaseIndex) => purchaseIndex !== index && purchase.id === nextPurchase.id)) {
    throw httpError(409, 'Purchase ID already exists')
  }

  removePurchaseFromInventory(store, previousPurchase)
  store.purchases[index] = nextPurchase
  applyPurchaseToInventory(store, nextPurchase)
  await storeModel.writeStore(store)

  const existing = findInventoryItem(store.inventory, nextPurchase)
  if (existing) {
    await stockMovementService.recordMovement({
      date: nextPurchase.date,
      sku: existing.sku,
      type: 'ADJUSTMENT', // Using adjustment for update to keep it simple, or purchase if we calculate diff
      quantity: nextPurchase.quantity - previousPurchase.quantity,
      previousStock: existing.stock - (nextPurchase.quantity - previousPurchase.quantity),
      newStock: existing.stock,
      reason: 'Purchase updated',
      reference: nextPurchase.id,
      originalQuantity: nextPurchase.originalQuantity,
      originalUnit: nextPurchase.originalUnit,
      convertedQuantity: nextPurchase.convertedQuantity,
      convertedUnit: nextPurchase.convertedUnit,
      warehouseCode: nextPurchase.warehouseCode,
    })
  }

  // Clear caches after updating
  CacheManager.clear()

  return purchaseDto(nextPurchase, currencyFromSettings(store.settings))
}

module.exports = {
  listPurchases,
  createPurchase,
  bulkImportPurchases,
  updatePurchase,
  updatePurchaseStatus,
  deletePurchase,
}

async function deletePurchase(id) {
  const store = await storeModel.readStore()
  const index = store.purchases.findIndex((row) => row.id === id)
  if (index === -1) throw httpError(404, 'Purchase not found')

  store.purchases.splice(index, 1)
  await storeModel.writeStore(store)
  try {
    const Purchase = require('../models/Purchase')
    await Purchase.deleteOne(storeModel.branchScopedQuery({ id }))
  } catch (e) {
    console.error('Error deleting purchase from MongoDB:', e)
  }
  CacheManager.clear()
  return { success: true, id }
}


function buildPurchaseRecord(body, store, index = 0) {
  const quantity = parseQuantity(body.quantity, 1)
  const unitPrice = parseMoney(body.unitPrice ?? body.price, 0)
  const inventoryPrice = parseMoney(body.inventoryPrice ?? body.inventoryprice, unitPrice)
  const total = quantity * unitPrice
  const payment = body.payment || 'Cash'
  const paidAmount = resolvePaidAmount(body, total, payment)
  const outstanding = resolveOutstanding(body, total, paidAmount, payment)
  const requestedId = String(body.id || body.purchaseid || '').trim()
  let id = requestedId || formatDocumentId('PO', { ...body, date: body.date || new Date().toISOString().slice(0, 10) }, new Date())

  while (store.purchases.some((purchase) => purchase.id === id)) {
    id = `${id}-${Math.random().toString(36).slice(2, 6)}`
  }

  return {
    date: body.date || new Date().toISOString().slice(0, 10),
    id,
    supplier: body.supplier || body.vendor || '',
    phone: body.phone || body.contact || '',
    item: body.item,
    sku: body.sku || body.barcode || '',
    category: body.category || 'Uncategorized',
    extractedText: body.extractedText || '',
    quantity,
    originalQuantity: quantity,
    originalUnit: normalizeUnitCode(body.unit || body.purchaseUnit || body.baseUnit || 'piece'),
    convertedQuantity: quantity,
    convertedUnit: normalizeUnitCode(body.baseUnit || body.unit || body.purchaseUnit || 'piece'),
    warehouseCode: String(body.warehouseCode || body.defaultWarehouseCode || '').trim().toUpperCase(),
    supplierId: String(body.supplierId || '').trim(),
    batchNumber: String(body.batchNumber || '').trim(),
    expiryDate: String(body.expiryDate || '').trim(),
    serialNumber: String(body.serialNumber || '').trim(),
    unitPrice,
    inventoryPrice,
    payment,
    paidAmount,
    outstanding,
    status: body.status || purchaseStatus(payment, outstanding),
  }
}

function removePurchaseFromInventory(store, purchase) {
  const existing = findInventoryItem(store.inventory, purchase)
  if (!existing) return

  existing.stock = Math.max(0, Number(existing.stock || 0) - Number(purchase.quantity || 0))
  existing.status = inventoryStatus(existing.stock)
}

function applyPurchaseToInventory(store, purchase) {
  const existing = findInventoryItem(store.inventory, purchase)

  if (existing) {
    existing.stock = Number(existing.stock || 0) + Number(purchase.quantity || 0)
    existing.capacity = Math.max(Number(existing.capacity || 0), Number(existing.stock || 0))
    existing.price = Number(purchase.inventoryPrice ?? purchase.unitPrice ?? existing.price ?? 0)
    existing.purchasePrice = Number(purchase.inventoryPrice ?? purchase.unitPrice ?? existing.purchasePrice ?? existing.price ?? 0)
    existing.status = inventoryStatus(existing.stock)
    existing.extractedText = purchase.extractedText || existing.extractedText || ''
    return
  }

  store.inventory.unshift({
    date: purchase.date,
    item: purchase.item,
    description: '',
    meta: 'Added from purchase',
    sku: purchase.sku || `SKU-${Date.now().toString().slice(-6)}`,
    category: purchase.category || 'Uncategorized',
    itemType: 'raw_material',
    baseUnit: purchase.convertedUnit || purchase.originalUnit || 'piece',
    stock: Number(purchase.quantity || 0),
    capacity: Math.max(Number(purchase.quantity || 0), 25),
    price: Number(purchase.inventoryPrice ?? purchase.unitPrice ?? 0),
    purchasePrice: Number(purchase.inventoryPrice ?? purchase.unitPrice ?? 0),
    sellingPrice: Number(purchase.inventoryPrice ?? purchase.unitPrice ?? 0),
    defaultSupplierId: purchase.supplierId || '',
    supplierOptions: purchase.supplier ? [{ supplierId: purchase.supplierId || '', supplierName: purchase.supplier, price: Number(purchase.unitPrice || 0), purchaseUnit: purchase.originalUnit || purchase.convertedUnit || 'piece' }] : [],
    priceTiers: [],
    defaultWarehouseCode: purchase.warehouseCode || '',
    batchTracking: Boolean(purchase.batchNumber),
    expiryTracking: Boolean(purchase.expiryDate),
    serialTracking: false,
    status: inventoryStatus(purchase.quantity),
    serial: '',
    supplier: purchase.supplier,
    extractedText: purchase.extractedText || '',
    shelfLocation: '',
    leadTime: '',
    warranty: '',
  })
}

async function applyPurchaseUnitConversion(purchase, store, body = {}) {
  const existing = findInventoryItem(store.inventory, purchase)
  const originalQuantity = Number(purchase.originalQuantity ?? purchase.quantity)
  const originalUnit = normalizeUnitCode(body.unit || body.purchaseUnit || purchase.originalUnit || existing?.baseUnit || body.baseUnit || 'piece')
  const convertedUnit = normalizeUnitCode(existing?.baseUnit || body.baseUnit || purchase.convertedUnit || originalUnit)
  const converted = existing
    ? await convertItemQuantity(existing, originalQuantity, originalUnit)
    : await convertQuantity({ quantity: originalQuantity, fromUnit: originalUnit, toUnit: convertedUnit, productSku: purchase.sku })
  purchase.originalQuantity = originalQuantity
  purchase.originalUnit = originalUnit
  purchase.convertedQuantity = converted.quantity
  purchase.convertedUnit = convertedUnit
  purchase.quantity = converted.quantity
  purchase.warehouseCode = String(body.warehouseCode || purchase.warehouseCode || existing?.defaultWarehouseCode || '').trim().toUpperCase()
  purchase.supplierId = String(body.supplierId || purchase.supplierId || '').trim()
  purchase.batchNumber = String(body.batchNumber || purchase.batchNumber || '').trim()
  purchase.expiryDate = String(body.expiryDate || purchase.expiryDate || '').trim()
  purchase.serialNumber = String(body.serialNumber || purchase.serialNumber || '').trim()
  if (body.inventoryPrice === undefined && converted.quantity > 0) {
    purchase.inventoryPrice = Number((Number(purchase.unitPrice || 0) * originalQuantity) / converted.quantity)
  }
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

function purchaseStatus(payment, outstanding) {
  if (isCreditPayment(payment) && outstanding > 0) return 'Pending'
  return 'Received'
}

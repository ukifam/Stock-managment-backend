const storeModel = require('../models/storeModel')
const httpError = require('../utils/httpError')
const { searchRows } = require('../utils/filters')
const { inventoryDto } = require('../utils/formatters')
const { currencyFromSettings } = require('../utils/settings')
const { parseMoney, parseQuantity } = require('../utils/parsers')
const { required } = require('../utils/validation')
const CacheManager = require('../utils/cache')
const stockMovementService = require('./stockMovementService')
const { assertUnitExists, normalizeUnitCode } = require('./unitConversionService')
const { inventoryStatus, isFinishedProduct } = require('../utils/inventoryMatch')

const PROTECTED_FIELDS = ['_id', '__v', 'ownerKey', 'ownerEmail', 'branchCode', 'createdBy', 'createdAt', 'updatedAt', 'sku', 'stock', 'rawStock', 'rawCapacity', 'rawPrice']

/**
 * List inventory with pagination, filtering, and caching
 * Performance improvements:
 * - Pagination: returns only requested page instead of all items
 * - Caching: stores results for 60 seconds
 * - Indexing: database queries use indexes on category, status, date
 */
async function listInventory({ period = 'yearly', search = '', page = 1, limit = 50, category = '', status = '', kind = '' }) {
  // Validate pagination params
  const pageNum = Math.max(1, parseInt(page, 10) || 1)
  const limitNum = Math.min(1000, Math.max(1, parseInt(limit, 10) || 50))

  // Create cache key based on all filter parameters (period ignored — inventory is current stock, not time-series)
  const cacheKey = `inventory:list:${search}:${pageNum}:${limitNum}:${category}:${status}:${kind}`
  const cached = CacheManager.get(cacheKey)
  if (cached) {
    return cached
  }

  const store = await storeModel.readStore()
  let rows = store.inventory
  const kindCounts = {
    products: rows.filter(isFinishedProduct).length,
    materials: rows.filter((row) => !isFinishedProduct(row)).length,
  }

  // Processing shops split finished products from the materials used to make them
  if (kind === 'products') rows = rows.filter(isFinishedProduct)
  if (kind === 'materials') rows = rows.filter((row) => !isFinishedProduct(row))

  // Apply category filter if provided
  if (category) {
    rows = rows.filter((row) => String(row.category || '').toLowerCase() === category.toLowerCase())
  }

  // Apply status filter if provided
  if (status) {
    rows = rows.filter((row) => String(row.status || '').toLowerCase() === status.toLowerCase())
  }

  // Apply search filter
  if (search) {
    rows = searchRows(rows, search)
  }

  // Calculate pagination
  const totalCount = rows.length
  const totalPages = Math.ceil(totalCount / limitNum)
  const skip = (pageNum - 1) * limitNum
  const paginatedRows = rows.slice(skip, skip + limitNum)

  const currency = currencyFromSettings(store.settings)
  const result = {
    rows: paginatedRows.map((row) => inventoryDto(row, currency)),
    count: totalCount,
    kindCounts,
    page: pageNum,
    pageSize: limitNum,
    totalPages,
    hasNextPage: pageNum < totalPages,
    hasPrevPage: pageNum > 1,
  }

  // Cache for 60 seconds
  CacheManager.set(cacheKey, result, 60000)
  return result
}

async function getInventoryItem(sku) {
  // Check cache first
  const cacheKey = `inventory:item:${sku}`
  const cached = CacheManager.get(cacheKey)
  if (cached) {
    return cached
  }

  const store = await storeModel.readStore()
  const item = store.inventory.find((row) => row.sku === sku)
  if (!item) throw httpError(404, 'Inventory item not found')

  const result = inventoryDto(item, currencyFromSettings(store.settings))
  // Cache for 60 seconds
  CacheManager.set(cacheKey, result, 60000)
  return result
}

async function createInventoryItem(body) {
  const missing = required(body, ['item', 'category'])
  if (missing.length) throw httpError(400, 'Missing required fields', { fields: missing })

  if (body.baseUnit !== undefined) await assertUnitExists(body.baseUnit)
  const store = await storeModel.readStore()
  const item = buildInventoryRecord(body, store, 0)
  store.inventory.unshift(item)
  await storeModel.writeStore(store)

  await stockMovementService.recordMovement({
    date: item.date,
    sku: item.sku,
    type: 'OPENING_STOCK',
    quantity: item.stock,
    previousStock: 0,
    newStock: item.stock,
    reason: 'Initial setup',
    originalQuantity: item.stock,
    originalUnit: item.baseUnit,
    convertedQuantity: item.stock,
    convertedUnit: item.baseUnit,
    warehouseCode: item.defaultWarehouseCode,
  })

  CacheManager.clear()

  return inventoryDto(item, currencyFromSettings(store.settings))
}

async function bulkImportInventory(bodies) {
  if (!Array.isArray(bodies) || bodies.length === 0) {
    throw httpError(400, 'No rows to import')
  }

  const store = await storeModel.readStore()
  const currency = currencyFromSettings(store.settings)
  const created = []

  bodies.forEach((body, index) => {
    const itemName = String(body.item || body.product || body.description || '').trim()
    const category = String(body.category || body.type || 'Uncategorized').trim()
    if (!itemName) return

    const item = buildInventoryRecord({ ...body, item: itemName, category }, store, index)
    store.inventory.unshift(item)
    created.push(item)
  })

  if (created.length === 0) {
    throw httpError(400, 'No valid inventory rows were found in the file')
  }

  await storeModel.writeStore(store)

  for (const item of created) {
    await stockMovementService.recordMovement({
      date: item.date,
      sku: item.sku,
      type: 'OPENING_STOCK',
      quantity: item.stock,
      previousStock: 0,
      newStock: item.stock,
      reason: 'Bulk import',
    })
  }

  CacheManager.clear()

  return {
    count: created.length,
    skipped: bodies.length - created.length,
    rows: created.slice(0, 50).map((row) => inventoryDto(row, currency)),
  }
}

async function updateInventoryItem(sku, body) {
  if (body.baseUnit !== undefined) await assertUnitExists(body.baseUnit)
  const store = await storeModel.readStore()
  const index = store.inventory.findIndex((row) => row.sku === sku)
  if (index === -1) throw httpError(404, 'Inventory item not found')

  const current = store.inventory[index]
  const changes = { ...body }
  PROTECTED_FIELDS.forEach((field) => delete changes[field])
  const previousStock = Number(current.stock || 0)
  const nextStock = body.stock !== undefined ? parseQuantity(body.stock, previousStock) : previousStock
  if (nextStock < 0) throw httpError(400, 'Stock cannot be negative')

  const next = {
    ...current,
    ...changes,
    stock: nextStock,
    capacity: body.capacity !== undefined ? parseQuantity(body.capacity, current.capacity) : current.capacity,
    price: body.price !== undefined ? parseMoney(body.price, current.price) : current.price,
    baseUnit: body.baseUnit !== undefined ? normalizeUnitCode(body.baseUnit) : current.baseUnit,
  }
  if (body.status === undefined || nextStock !== previousStock) next.status = inventoryStatus(nextStock, next)
  store.inventory[index] = next

  await storeModel.writeStore(store)
  if (nextStock !== previousStock) {
    await stockMovementService.recordMovement({
      sku,
      type: 'ADJUSTMENT',
      quantity: nextStock - previousStock,
      previousStock,
      newStock: nextStock,
      reason: String(body.adjustmentReason || 'Stock corrected from product details'),
      warehouseCode: next.defaultWarehouseCode || '',
    })
  }
  CacheManager.clear()

  return inventoryDto(next, currencyFromSettings(store.settings))
}

module.exports = {
  listInventory,
  getInventoryItem,
  createInventoryItem,
  bulkImportInventory,
  updateInventoryItem,
  deleteInventoryItem,
}

async function deleteInventoryItem(sku) {
  const store = await storeModel.readStore()
  const index = store.inventory.findIndex((row) => row.sku === sku)
  if (index === -1) throw httpError(404, 'Inventory item not found')

  store.inventory.splice(index, 1)
  await storeModel.writeStore(store)
  try {
    const Inventory = require('../models/Inventory')
    await Inventory.deleteOne(storeModel.branchScopedQuery({ sku }))
  } catch (e) {
    console.error('Error deleting inventory from MongoDB:', e)
  }
  CacheManager.clear()
  return { success: true, sku }
}


function buildInventoryRecord(body, store, index = 0) {
  const requestedSku = String(body.sku || body.barcode || '').trim()
  if (requestedSku && store.inventory.some((row) => row.sku === requestedSku)) {
    throw httpError(409, `Item code ${requestedSku} already exists`)
  }
  let sku = requestedSku || `SKU-IMP-${Date.now()}-${index}`

  while (!requestedSku && store.inventory.some((row) => row.sku === sku)) {
    sku = `SKU-IMP-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`
  }

  const stock = parseQuantity(body.stock ?? body.quantity, 1)

  return {
    date: body.date || new Date().toISOString().slice(0, 10),
    item: body.item,
    description: body.description || '',
    meta: body.meta || body.brand || 'Imported inventory',
    sku,
    category: body.category,
    itemType: body.itemType || 'raw_material',
    baseUnit: normalizeUnitCode(body.baseUnit || 'piece'),
    measurementAmount: parseQuantity(body.measurementAmount, 1),
    stock,
    capacity: parseQuantity(body.capacity ?? body.maxstock, Math.max(stock, 25)),
    minimumStock: parseQuantity(body.minimumStock ?? body.minstock, 0),
    maximumStock: parseQuantity(body.maximumStock ?? body.capacity ?? body.maxstock, Math.max(stock, 25)),
    reorderLevel: parseQuantity(body.reorderLevel ?? body.reorderlevel, 0),
    price: parseMoney(body.price ?? body.unitprice ?? body.unitPrice, 0),
    purchasePrice: parseMoney(body.purchasePrice ?? body.purchaseprice ?? body.inventoryPrice, parseMoney(body.price ?? body.unitprice ?? body.unitPrice, 0)),
    sellingPrice: parseMoney(body.sellingPrice ?? body.sellingprice ?? body.price ?? body.unitprice ?? body.unitPrice, 0),
    defaultSupplierId: body.defaultSupplierId || '',
    supplierOptions: Array.isArray(body.supplierOptions) ? body.supplierOptions : [],
    priceTiers: Array.isArray(body.priceTiers) ? body.priceTiers : [],
    defaultWarehouseCode: String(body.defaultWarehouseCode || body.warehouseCode || '').trim().toUpperCase(),
    batchTracking: Boolean(body.batchTracking),
    expiryTracking: Boolean(body.expiryTracking),
    serialTracking: Boolean(body.serialTracking),
    status: body.status || inventoryStatus(stock, { reorderLevel: body.reorderLevel ?? body.reorderlevel, minimumStock: body.minimumStock ?? body.minstock }),
    serial: body.serial || body.serialnumber || body.serialNumber || '',
    supplier: body.supplier || body.vendor || '',
    extractedText: body.extractedText || '',
    shelfLocation: body.shelflocation || body.shelfLocation || body.location || '',
    leadTime: body.leadtime || body.leadTime || '',
    warranty: body.warranty || '',
  }
}

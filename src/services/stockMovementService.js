const storeModel = require('../models/storeModel')
const httpError = require('../utils/httpError')
const { required } = require('../utils/validation')
const CacheManager = require('../utils/cache')

async function listStockMovements({ sku, type, search, page = 1, limit = 50 }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1)
  const limitNum = Math.min(1000, Math.max(1, parseInt(limit, 10) || 50))
  
  const query = {}
  if (sku) {
    query.sku = { $regex: sku, $options: 'i' }
  }
  if (type && type !== 'ALL') {
    query.type = type
  }
  if (search) {
    query.$or = [
      { sku: { $regex: search, $options: 'i' } },
      { reason: { $regex: search, $options: 'i' } },
      { reference: { $regex: search, $options: 'i' } },
      { user: { $regex: search, $options: 'i' } }
    ]
  }
  const skip = (pageNum - 1) * limitNum

  const [rows, totalCount] = await Promise.all([
    storeModel.StockMovement.find(query).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limitNum).lean(),
    storeModel.StockMovement.countDocuments(query)
  ])

  // Attach product names from inventory if available
  const store = await storeModel.readStore()
  const inventoryMap = new Map((store.inventory || []).map(i => [i.sku, i.item]))
  const enrichedRows = rows.map(r => ({
    ...r,
    item: inventoryMap.get(r.sku) || r.sku
  }))

  const totalPages = Math.ceil(totalCount / limitNum)

  return {
    rows: enrichedRows,
    count: totalCount,
    page: pageNum,
    pageSize: limitNum,
    totalPages,
    hasNextPage: pageNum < totalPages,
    hasPrevPage: pageNum > 1,
  }
}

/**
 * Creates a stock adjustment and updates the inventory stock quantity.
 */
async function adjustStock(body) {
  const missing = required(body, ['sku', 'quantity', 'type', 'reason'])
  if (missing.length) throw httpError(400, 'Missing required fields', { fields: missing })

  const store = await storeModel.readStore()
  const inventoryIndex = store.inventory.findIndex(item => item.sku === body.sku)
  
  if (inventoryIndex === -1) {
    throw httpError(404, 'Inventory item not found')
  }

  const item = store.inventory[inventoryIndex]
  const previousStock = item.stock
  const quantityChange = parseFloat(body.quantity)
  const newStock = previousStock + quantityChange

  // Update inventory item in memory for the storeModel
  store.inventory[inventoryIndex] = {
    ...item,
    stock: newStock,
    status: newStock <= 0 ? 'Out of Stock' : (newStock <= (item.capacity * 0.2) ? 'Low' : 'Active')
  }

  // Create the movement record
  const movement = await storeModel.StockMovement.create({
    date: body.date || new Date().toISOString().slice(0, 10),
    sku: body.sku,
    type: body.type,
    quantity: quantityChange,
    previousStock,
    newStock,
    reason: body.reason,
    reference: body.reference || '',
    user: body.user || 'System'
  })

  // Save the updated inventory
  await storeModel.writeStore(store)
  
  // Clear inventory caches since stock changed
  CacheManager.clear()

  return movement
}

/**
 * Internal function to record a movement without manual API call (e.g. from purchases/sales)
 */
async function recordMovement(data) {
  return storeModel.StockMovement.create({
    date: data.date || new Date().toISOString().slice(0, 10),
    sku: data.sku,
    type: data.type,
    quantity: data.quantity,
    previousStock: data.previousStock,
    newStock: data.newStock,
    reason: data.reason || '',
    reference: data.reference || '',
    user: data.user || 'System'
  })
}

module.exports = {
  listStockMovements,
  adjustStock,
  recordMovement
}

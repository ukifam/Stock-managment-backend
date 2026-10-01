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
      { partner: { $regex: search, $options: 'i' } },
      { user: { $regex: search, $options: 'i' } }
    ]
  }
  const skip = (pageNum - 1) * limitNum

  const scopedQuery = storeModel.scopedQuery(query)
  const [rows, totalCount] = await Promise.all([
    storeModel.StockMovement.find(scopedQuery).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limitNum).lean(),
    storeModel.StockMovement.countDocuments(scopedQuery)
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
    ...storeModel.withTenantFields({
    date: body.date || new Date().toISOString().slice(0, 10),
    sku: body.sku,
    type: body.type,
    quantity: quantityChange,
    previousStock,
    newStock,
    reason: body.reason,
    reference: body.reference || '',
    partner: body.partner || '',
    showcaseQuantity: Number(body.showcaseQuantity || 0),
    expectedReturnDate: body.expectedReturnDate || '',
    user: body.user || 'System'
    })
  })

  // Save the updated inventory
  await storeModel.writeStore(store)
  
  // Clear inventory caches since stock changed
  CacheManager.clear()

  return movement
}

async function sendToShowcase(body) {
  const missing = required(body, ['sku', 'quantity', 'partner'])
  if (missing.length) throw httpError(400, 'Missing required fields', { fields: missing })

  const quantity = Number(body.quantity)
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw httpError(400, 'Showcase quantity must be a positive whole number')
  }

  const store = await storeModel.readStore()
  const inventoryIndex = store.inventory.findIndex((item) => item.sku === body.sku)
  if (inventoryIndex === -1) throw httpError(404, 'Inventory item not found')

  const item = store.inventory[inventoryIndex]
  const previousStock = Number(item.stock || 0)
  if (quantity > previousStock) {
    throw httpError(400, `Only ${previousStock} units are in stock; cannot send ${quantity} to the showcase`)
  }

  const date = body.date || new Date().toISOString().slice(0, 10)
  const reference = `SHOW-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
  const newStock = previousStock - quantity
  store.inventory[inventoryIndex] = {
    ...item,
    stock: newStock,
    status: inventoryStatus(newStock, item.capacity),
  }

  const movement = await storeModel.StockMovement.create({
    ...storeModel.withTenantFields({
      date,
      sku: item.sku,
      type: 'SHOWCASE_OUT',
      quantity: -quantity,
      previousStock,
      newStock,
      reason: body.notes || `Temporary showcase issue to ${String(body.partner).trim()}`,
      reference,
      partner: String(body.partner).trim(),
      showcaseQuantity: quantity,
      expectedReturnDate: body.expectedReturnDate || '',
      user: body.user || 'System',
    }),
  })

  await storeModel.writeStore(store)
  CacheManager.clear()
  return { ...movement.toObject?.() || movement, item: item.item }
}

async function listOpenShowcases() {
  const movements = await storeModel.StockMovement
    .find(storeModel.scopedQuery({ type: { $in: ['SHOWCASE_OUT', 'SHOWCASE_RETURN', 'SHOWCASE_SALE'] } }))
    .sort({ date: 1, createdAt: 1 })
    .lean()
  const cases = new Map()

  movements.forEach((movement) => {
    if (!movement.reference) return
    const current = cases.get(movement.reference) || {
      reference: movement.reference,
      sku: movement.sku,
      item: movement.sku,
      partner: movement.partner || '',
      issueDate: movement.date,
      expectedReturnDate: movement.expectedReturnDate || '',
      quantityIssued: 0,
      quantityReturned: 0,
      quantitySold: 0,
    }
    if (movement.type === 'SHOWCASE_OUT') {
      current.quantityIssued += Number(movement.showcaseQuantity || Math.abs(movement.quantity) || 0)
      current.partner = movement.partner || current.partner
      current.issueDate = movement.date
      current.expectedReturnDate = movement.expectedReturnDate || current.expectedReturnDate
    } else if (movement.type === 'SHOWCASE_RETURN') {
      current.quantityReturned += Number(movement.showcaseQuantity || movement.quantity || 0)
    } else if (movement.type === 'SHOWCASE_SALE') {
      current.quantitySold += Number(movement.showcaseQuantity || 0)
    }
    cases.set(movement.reference, current)
  })

  const store = await storeModel.readStore()
  const itemNames = new Map(store.inventory.map((item) => [item.sku, item.item]))
  return [...cases.values()]
    .map((showcase) => ({
      ...showcase,
      item: itemNames.get(showcase.sku) || showcase.item,
      remainingQuantity: showcase.quantityIssued - showcase.quantityReturned - showcase.quantitySold,
    }))
    .filter((showcase) => showcase.remainingQuantity > 0)
    .sort((left, right) => right.issueDate.localeCompare(left.issueDate))
}

async function closeShowcase(reference, body) {
  const movements = await storeModel.StockMovement
    .find(storeModel.scopedQuery({ reference }))
    .sort({ date: 1, createdAt: 1 })
    .lean()
  const issue = movements.find((movement) => movement.type === 'SHOWCASE_OUT')
  if (!issue) throw httpError(404, 'Open showcase issue not found')

  const issued = movements
    .filter((movement) => movement.type === 'SHOWCASE_OUT')
    .reduce((sum, movement) => sum + Number(movement.showcaseQuantity || Math.abs(movement.quantity) || 0), 0)
  const alreadyReturned = movements
    .filter((movement) => movement.type === 'SHOWCASE_RETURN')
    .reduce((sum, movement) => sum + Number(movement.showcaseQuantity || movement.quantity || 0), 0)
  const alreadySold = movements
    .filter((movement) => movement.type === 'SHOWCASE_SALE')
    .reduce((sum, movement) => sum + Number(movement.showcaseQuantity || 0), 0)
  const remaining = issued - alreadyReturned - alreadySold
  const quantity = Number(body.quantity)
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > remaining) {
    throw httpError(400, `Enter a whole number from 1 to ${remaining} for the remaining showcase quantity`)
  }

  const outcome = String(body.outcome || '').toUpperCase()
  const store = await storeModel.readStore()
  const item = store.inventory.find((row) => row.sku === issue.sku)
  if (!item) throw httpError(404, 'Inventory item not found')

  if (outcome === 'RETURNED') {
    return adjustStock({
      sku: issue.sku,
      type: 'SHOWCASE_RETURN',
      quantity,
      date: body.date,
      reason: body.notes || `Unsold showcase item returned by ${issue.partner || 'partner'}`,
      reference,
      partner: issue.partner,
      showcaseQuantity: quantity,
      expectedReturnDate: issue.expectedReturnDate,
      user: body.user || 'System',
    })
  }

  if (outcome !== 'SOLD') throw httpError(400, 'Choose whether the showcase item was returned or sold')
  const unitPrice = Number(body.unitPrice)
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw httpError(400, 'Enter the agreed selling price per unit')

  const saleService = require('./saleService')
  const payment = body.payment || 'Cash'
  const total = quantity * unitPrice
  const paidAmount = body.paidAmount === undefined
    ? (String(payment).toLowerCase() === 'credit' ? 0 : total)
    : Number(body.paidAmount)
  return saleService.createSale({
    date: body.date,
    reference,
    customer: issue.partner,
    item: item.item,
    sku: item.sku,
    category: item.category,
    quantity,
    unitPrice,
    total,
    payment,
    paidAmount,
    user: body.user || 'Showcase Closeout',
  }, {
    stockAlreadyDeducted: true,
    showcase: { reference },
  })
}

function inventoryStatus(stock, capacity) {
  if (stock <= 0) return 'Out of Stock'
  if (stock <= Number(capacity || 0) * 0.2) return 'Low'
  return 'Active'
}

/**
 * Internal function to record a movement without manual API call (e.g. from purchases/sales)
 */
async function recordMovement(data) {
  return storeModel.StockMovement.create({
    ...storeModel.withTenantFields({
    date: data.date || new Date().toISOString().slice(0, 10),
    sku: data.sku,
    type: data.type,
    quantity: data.quantity,
    previousStock: data.previousStock,
    newStock: data.newStock,
    reason: data.reason || '',
    reference: data.reference || '',
    partner: data.partner || '',
    showcaseQuantity: Number(data.showcaseQuantity || 0),
    expectedReturnDate: data.expectedReturnDate || '',
    user: data.user || 'System'
    })
  })
}

module.exports = {
  listStockMovements,
  adjustStock,
  sendToShowcase,
  listOpenShowcases,
  closeShowcase,
  recordMovement
}

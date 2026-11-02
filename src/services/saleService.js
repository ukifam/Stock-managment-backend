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
const { convertItemQuantity, normalizeUnitCode } = require('./unitConversionService')
const warehouseStockService = require('./warehouseStockService')
const Customer = require('../models/Customer')
const SaleReturn = require('../models/SaleReturn')
const { auditActor } = require('../utils/tenantContext')
const { findInventoryItem, inventoryStatus, isSellableStatus } = require('../utils/inventoryMatch')

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
    rows = rows.filter((row) => String(row.status || '').toLowerCase() === status.toLowerCase())
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

function normalizePaymentMethod(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  const methods = new Map([
    ['cash', 'Cash'],
    ['card', 'Card'],
    ['mobile money', 'Mobile Money'],
    ['momo', 'Mobile Money'],
    ['credit', 'Credit'],
    ['bank transfer', 'Bank Transfer'],
    ['bank', 'Bank Transfer'],
  ])
  const method = methods.get(normalized)
  if (!method) throw httpError(400, 'Payment method must be cash, card, mobile money, bank transfer, or credit')
  return method
}

function calculateSaleFinancials(saleItems, discountInput, taxInput) {
  const subtotal = round(saleItems.reduce((sum, item) => sum + Number(item.total || 0), 0))
  const discount = Number(discountInput || 0)
  const tax = Number(taxInput || 0)
  if (!Number.isFinite(discount) || discount < 0 || discount > subtotal) {
    throw httpError(400, 'Discount must be between zero and the sale subtotal')
  }
  if (!Number.isFinite(tax) || tax < 0) throw httpError(400, 'Tax must be a non-negative amount')
  const total = round(subtotal - discount + tax)
  const netRevenue = round(subtotal - discount)
  const costOfGoodsSold = round(saleItems.reduce((sum, item) => sum + Number(item.costOfGoodsSold || 0), 0))
  const grossProfit = round(netRevenue - costOfGoodsSold)
  const grossMarginPercent = netRevenue > 0 ? round(grossProfit / netRevenue * 100) : 0
  return { subtotal, discount, tax: round(tax), total, netRevenue, costOfGoodsSold, grossProfit, grossMarginPercent }
}

function round(value) {
  return Number(Number(value || 0).toFixed(4))
}

async function createSale(body, options = {}) {
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
      quantity: saleQuantity(it.quantity),
      originalQuantity: saleQuantity(it.quantity),
      originalUnit: normalizeUnitCode(it.unit || body.unit || 'piece'),
      unitPrice: Math.max(0, parseFloat(it.unitPrice) || 0),
      total: Math.max(0, saleQuantity(it.quantity) * (parseFloat(it.unitPrice) || 0)),
    }))
  } else if (body.item) {
    const qty = saleQuantity(body.quantity)
    const val = parseFloat(body.value ?? body.total) || 0
    const price = body.unitPrice ? parseFloat(body.unitPrice) : (qty ? val / qty : 0)
    saleItems = [
      {
        sku: String(body.sku || '').trim(),
        item: String(body.item || '').trim(),
        category: String(body.category || 'General').trim(),
        quantity: qty,
        originalQuantity: qty,
        originalUnit: normalizeUnitCode(body.unit || 'piece'),
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
  const requestedByInventoryItem = new Map()
  const requestedByWarehouse = new Map()
  const isPipelineOrFlexible = Boolean(body.source === 'pipeline' || body.allowFlexibleStock || options.allowExternalItem)

  for (const sItem of saleItems) {
    let invItem = findInventoryItem(store.inventory, sItem)
    if (!invItem && isPipelineOrFlexible) {
      const generatedSku = sItem.sku || `PROD-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
      invItem = {
        date: body.date || new Date().toISOString().slice(0, 10),
        item: sItem.item || 'Pipeline Finished Product',
        description: sItem.description || 'Produced from Production Pipeline',
        meta: 'Production Pipeline',
        sku: generatedSku,
        category: sItem.category || 'Finished Goods',
        itemType: 'finished_good',
        baseUnit: normalizeUnitCode(sItem.unit || 'piece'),
        stock: Math.max(Number(sItem.quantity || 1), 0),
        capacity: Math.max(Number(sItem.quantity || 1), 25),
        minimumStock: 0,
        maximumStock: Math.max(Number(sItem.quantity || 1), 100),
        reorderLevel: 0,
        price: parseMoney(sItem.price ?? sItem.unitPrice ?? 0),
        sellingPrice: parseMoney(sItem.price ?? sItem.unitPrice ?? 0),
        purchasePrice: parseMoney(sItem.costBasis ?? sItem.unitCost ?? 0),
        status: 'Active',
      }
      if (!options.stockAlreadyDeducted) store.inventory.unshift(invItem)
    }
    if (!invItem) {
      throw httpError(404, `Product not found in inventory: ${sItem.item || sItem.sku}`)
    }
    if (isPipelineOrFlexible && Number(invItem.stock || 0) < Number(sItem.quantity || 1)) {
      invItem.stock = Number(sItem.quantity || 1)
    }
    const currentStock = Number(invItem.stock || 0)
    const originalQuantity = Number(sItem.originalQuantity ?? sItem.quantity)
    const originalUnit = normalizeUnitCode(sItem.originalUnit || sItem.unit || body.unit || invItem.baseUnit || 'piece')
    let converted
    try {
      converted = await convertItemQuantity(invItem, originalQuantity, originalUnit)
    } catch {
      converted = { quantity: originalQuantity, factor: 1, path: [originalUnit] }
    }
    sItem.originalQuantity = originalQuantity
    sItem.originalUnit = originalUnit
    sItem.convertedQuantity = converted.quantity
    sItem.convertedUnit = invItem.baseUnit || originalUnit
    sItem.quantity = converted.quantity
    const requestedQuantity = Number(requestedByInventoryItem.get(invItem.sku)?.quantity || 0) + sItem.quantity
    if (!options.stockAlreadyDeducted && !isPipelineOrFlexible && requestedQuantity > currentStock) {
      throw httpError(400, `Insufficient stock for ${invItem.item} (SKU: ${invItem.sku}). Requested: ${requestedQuantity}, Available: ${currentStock}`)
    }
    const warehouseCode = String(body.warehouseCode || invItem.defaultWarehouseCode || '').trim().toUpperCase()
    const warehouseKey = `${invItem.sku}:${warehouseCode}`
    const warehouseDemand = requestedByWarehouse.get(warehouseKey) || { item: invItem, quantity: 0, warehouseCode }
    warehouseDemand.quantity += sItem.quantity
    requestedByWarehouse.set(warehouseKey, warehouseDemand)
    sItem.sku = invItem.sku
    sItem.item = invItem.item
    sItem.category = invItem.category || sItem.category
    sItem.costBasis = options.partnerUnitCost !== undefined
      ? Math.max(0, Number(options.partnerUnitCost) || 0)
      : Math.max(0, await warehouseStockService.getAverageCost(invItem, body.warehouseCode || invItem.defaultWarehouseCode))
    sItem.costOfGoodsSold = round(sItem.quantity * sItem.costBasis)
    sItem.grossProfit = round(sItem.total - sItem.costOfGoodsSold)
    sItem.grossMarginPercent = sItem.total > 0 ? round(sItem.grossProfit / sItem.total * 100) : 0
    const aggregate = requestedByInventoryItem.get(invItem.sku) || { invItem, quantity: 0, prevStock: currentStock }
    aggregate.quantity += sItem.quantity
    requestedByInventoryItem.set(invItem.sku, aggregate)
    inventoryItemsToUpdate.push({ invItem, saleItem: sItem, prevStock: currentStock })
  }

  if (!options.stockAlreadyDeducted && !isPipelineOrFlexible) {
    for (const demand of requestedByWarehouse.values()) {
      await warehouseStockService.assertWarehouseAvailable(demand)
    }
  }

  if (!options.stockAlreadyDeducted) {
    for (const { invItem, quantity, prevStock } of requestedByInventoryItem.values()) {
      invItem.stock = Math.max(0, prevStock - quantity)
      invItem.status = inventoryStatus(invItem.stock, invItem)
    }
  }

  const { subtotal, discount, tax, total, netRevenue, costOfGoodsSold, grossProfit, grossMarginPercent } =
    calculateSaleFinancials(saleItems, body.discount, body.tax)
  const payment = normalizePaymentMethod(body.payment || 'Cash')
  const paidAmount = resolvePaidAmount(body, total, payment, 0)
  const outstanding = resolveOutstanding(body, total, paidAmount, payment, Math.max(0, total - paidAmount))
  await validateCustomerCredit(body, store, outstanding)

  const date = (body.date ? String(body.date).slice(0, 10) : '') || new Date().toISOString().slice(0, 10)
  const explicitId = String(body.id || body.saleid || '').trim()
  if (explicitId && store.sales.some((s) => s.id === explicitId || s.reference === explicitId)) {
    const existing = store.sales.find((s) => s.id === explicitId || s.reference === explicitId)
    return saleDto(existing, currencyFromSettings(store.settings))
  }
  let id = explicitId || formatDocumentId('SO', { ...body, date }, new Date())
  while (store.sales.some((sale) => sale.id === id)) {
    id = `${id}-${Math.random().toString(36).slice(2, 6)}`
  }

  const summaryItemText = saleItems.length === 1
    ? saleItems[0].item
    : `${saleItems.length} items (${saleItems.map((i) => `${i.item} × ${i.quantity}`).join(', ').slice(0, 50)}...)`

  const sale = {
    date,
    id,
    source: body.source || 'pos',
    reference: String(body.reference || '').trim(),
    customer: body.customer,
    phone: body.phone || body.contact || '',
    item: summaryItemText,
    sku: saleItems[0]?.sku || '',
    category: saleItems[0]?.category || 'General',
    extractedText: body.extractedText || '',
    quantity: saleItems.reduce((sum, it) => sum + it.quantity, 0),
    originalQuantity: saleItems.reduce((sum, it) => sum + Number(it.originalQuantity ?? it.quantity), 0),
    originalUnit: saleItems.length === 1 ? saleItems[0].originalUnit : '',
    convertedQuantity: saleItems.reduce((sum, it) => sum + it.quantity, 0),
    convertedUnit: saleItems.length === 1 ? saleItems[0].convertedUnit : '',
    warehouseCode: String(body.warehouseCode || '').trim().toUpperCase(),
    customerId: String(body.customerId || '').trim(),
    serialNumber: String(body.serialNumber || '').trim(),
    subtotal,
    discount,
    tax,
    value: total,
    netRevenue,
    costOfGoodsSold,
    grossProfit,
    grossMarginPercent,
    payment,
    paidAmount,
    outstanding,
    status: body.status || saleStatus(payment, outstanding),
    items: saleItems,
  }

  store.sales.unshift(sale)
  await storeModel.writeStore(store)

  if (options.stockAlreadyDeducted && options.showcase) {
    for (const { invItem, saleItem } of inventoryItemsToUpdate) {
      await stockMovementService.recordMovement({
        date,
        sku: invItem.sku,
        type: 'SHOWCASE_SALE',
        quantity: 0,
        previousStock: invItem.stock,
        newStock: invItem.stock,
        reason: `Showcase ${options.showcase.reference} sold ${saleItem.quantity}x ${saleItem.item} to ${body.customer}; sale ${id}`,
        reference: options.showcase.reference,
        partner: body.customer,
        showcaseQuantity: saleItem.quantity,
        user: body.user || 'Showcase Closeout',
      })
    }
  } else if (!options.stockAlreadyDeducted) {
    // Record individual stock movements for each sale item.
    const stockBeforeMovement = new Map([...requestedByInventoryItem.entries()].map(([sku, entry]) => [sku, entry.prevStock]))
    for (const { invItem, saleItem, prevStock } of inventoryItemsToUpdate) {
      const movementPreviousStock = stockBeforeMovement.get(invItem.sku) ?? prevStock
      const movementNewStock = movementPreviousStock - saleItem.quantity
      await stockMovementService.recordMovement({
        date,
        sku: invItem.sku,
        type: 'SALE',
        quantity: -saleItem.quantity,
        originalQuantity: saleItem.originalQuantity,
        originalUnit: saleItem.originalUnit,
        convertedQuantity: saleItem.convertedQuantity,
        convertedUnit: saleItem.convertedUnit,
        warehouseCode: body.warehouseCode || invItem.defaultWarehouseCode || '',
        serialNumber: body.serialNumber || '',
        previousStock: movementPreviousStock,
        newStock: movementNewStock,
        reason: `Sale ${id} to ${body.customer}: ${saleItem.quantity}x ${saleItem.item}`,
        reference: id,
        user: body.user || 'Cashier',
      })
      stockBeforeMovement.set(invItem.sku, movementNewStock)
    }
  }

  CacheManager.clear()
  return saleDto(sale, currencyFromSettings(store.settings))
}

function saleQuantity(value) {
  if (value === undefined || value === null || value === '') return 1
  const quantity = Number(value)
  if (!Number.isFinite(quantity) || quantity <= 0) throw httpError(400, 'Sale quantities must be greater than zero')
  return quantity
}

async function validateCustomerCredit(body, store, outstanding) {
  if (outstanding <= 0 || !storeModel.Customer) return
  const customerId = String(body.customerId || '').trim()
  const customer = await Customer.findOne(storeModel.scopedQuery(customerId ? { _id: customerId } : { name: body.customer })).lean()
  const creditLimit = Number(customer?.creditLimit || 0)
  if (!customer || creditLimit <= 0) return
  const currentOutstanding = store.sales
    .filter((sale) => (customerId && sale.customerId === customerId) || (!customerId && String(sale.customer || '').toLowerCase() === String(body.customer || '').toLowerCase()))
    .reduce((total, sale) => total + Number(sale.outstanding || 0), 0)
  if (currentOutstanding + outstanding > creditLimit) {
    throw httpError(400, `${customer.name} would exceed the credit limit of ${creditLimit}`)
  }
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

const ALLOWED_STATUSES = ['Pending', 'Given', 'Returned', 'Completed', 'Cancelled']

async function updateSaleStatus(id, requestedStatus) {
  const status = ALLOWED_STATUSES.find((value) => value.toLowerCase() === String(requestedStatus || '').trim().toLowerCase())
  if (!status) throw httpError(400, `Status must be one of: ${ALLOWED_STATUSES.join(', ')}`)
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
  const store = await storeModel.readStore()
  const index = store.sales.findIndex((sale) => sale.id === id)
  if (index === -1) throw httpError(404, 'Sale not found')

  const previousSale = store.sales[index]
  const isMultiItem = Array.isArray(previousSale.items) && previousSale.items.length > 1
  const customer = String(body.customer ?? previousSale.customer ?? '').trim()
  if (!customer) throw httpError(400, 'Missing required fields', { fields: ['customer'] })
  if (!isMultiItem && !String(body.item ?? previousSale.item ?? '').trim()) {
    throw httpError(400, 'Missing required fields', { fields: ['item'] })
  }

  const quantity = isMultiItem ? previousSale.quantity : parseQuantity(body.quantity ?? body.items, previousSale.quantity)
  const value = isMultiItem ? previousSale.value : parseMoney(body.value ?? body.total ?? previousSale.value, previousSale.value)
  const payment = normalizePaymentMethod(body.payment || previousSale.payment || 'Cash')
  const paidAmount = resolvePaidAmount(body, value, payment, previousSale.paidAmount)
  const outstanding = resolveOutstanding(body, value, paidAmount, payment, Math.max(0, value - paidAmount))

  const nextSale = {
    ...previousSale,
    date: body.date || previousSale.date,
    id: body.id || previousSale.id,
    customer,
    phone: body.phone ?? previousSale.phone ?? '',
    extractedText: body.extractedText ?? previousSale.extractedText ?? '',
    payment,
    paidAmount,
    outstanding,
    status: body.status || saleStatus(payment, outstanding),
  }

  if (!isMultiItem) {
    Object.assign(nextSale, {
      item: body.item ?? previousSale.item,
      sku: body.sku || previousSale.sku || '',
      category: body.category || previousSale.category || 'Uncategorized',
      quantity,
      value,
    })
    // Keep the stored line item and financials consistent with the edited totals.
    const unitCost = Number(previousSale.items?.[0]?.costBasis ?? 0)
    const unitPrice = quantity > 0 ? value / quantity : 0
    const line = { ...(previousSale.items?.[0] || {}), sku: nextSale.sku, item: nextSale.item, category: nextSale.category, quantity, unitPrice, total: value, costBasis: unitCost }
    line.costOfGoodsSold = round(quantity * unitCost)
    line.grossProfit = round(value - line.costOfGoodsSold)
    nextSale.items = [line]
    Object.assign(nextSale, calculateSaleFinancials([line], 0, 0), { value })
  }

  if (nextSale.id !== previousSale.id && store.sales.some((sale, saleIndex) => saleIndex !== index && sale.id === nextSale.id)) {
    throw httpError(409, 'Sale ID already exists')
  }

  const quantityChanged = !isMultiItem && (nextSale.quantity !== previousSale.quantity || findInventoryItem(store.inventory, nextSale) !== findInventoryItem(store.inventory, previousSale))
  if (quantityChanged) {
    removeSaleFromInventory(store, previousSale)
    applySaleToInventory(store, nextSale)
  }
  store.sales[index] = nextSale
  await storeModel.writeStore(store)

  const existing = quantityChanged ? findInventoryItem(store.inventory, nextSale) : null
  if (existing) {
    const delta = nextSale.quantity - previousSale.quantity
    await stockMovementService.recordMovement({
      date: nextSale.date,
      sku: existing.sku,
      type: 'ADJUSTMENT',
      quantity: -delta,
      previousStock: existing.stock + delta,
      newStock: existing.stock,
      reason: `Sale ${nextSale.id} updated`,
      reference: nextSale.id,
    })
  }

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
    .filter((item) => Number(item.stock || 0) > 0 && isSellableStatus(item.status))
    .map((item) => ({
      sku: item.sku,
      item: item.item,
      category: item.category,
      stock: Number(item.stock || 0),
      price: Number(item.sellingPrice ?? item.price ?? 0),
    }))
    .sort((a, b) => a.item.localeCompare(b.item))

  const result = { items: availableItems }
  CacheManager.set(cacheKey, result, 60000)
  return result
}

async function createSaleReturn(saleId, body = {}) {
  const reason = String(body.reason || '').trim()
  if (!reason) throw httpError(400, 'A return reason is required')
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw httpError(400, 'At least one returned item is required')
  }

  const store = await storeModel.readStore()
  const sale = store.sales.find((row) => row.id === saleId)
  if (!sale) throw httpError(404, 'Sale not found')
  const saleItems = Array.isArray(sale.items) && sale.items.length
    ? sale.items
    : [{ sku: sale.sku || '', item: sale.item, quantity: sale.quantity }]
  const scopedReturns = await SaleReturn.find(storeModel.branchScopedQuery({ saleId })).lean()
  const aggregatedItems = validateSaleReturnItems(saleId, saleItems, scopedReturns, body.items)

  const id = formatDocumentId('SR', { date: new Date().toISOString().slice(0, 10) }, new Date())
  const saleReturn = await SaleReturn.create(storeModel.withBranchFields({
    id,
    saleId,
    date: new Date().toISOString().slice(0, 10),
    reason,
    items: aggregatedItems,
    status: 'Pending',
  }))
  return saleReturn.toObject()
}

async function listSaleReturns(saleId) {
  return SaleReturn.find(storeModel.branchScopedQuery({ saleId })).sort({ createdAt: -1 }).lean()
}

async function approveSaleReturn(id) {
  const saleReturn = await SaleReturn.findOne(storeModel.branchScopedQuery({ id }))
  if (!saleReturn) throw httpError(404, 'Return request not found')
  if (saleReturn.status === 'Approved') return saleReturn.toObject()
  if (saleReturn.status !== 'Pending') throw httpError(409, 'Only pending returns can be approved')

  for (const item of saleReturn.items) {
    const store = await storeModel.readStore()
    const inventoryItem = findInventoryItem(store.inventory, item)
    if (!inventoryItem) throw httpError(404, `Inventory item not found for returned product ${item.item}`)
    const reference = saleReturn.id
    const existingMovement = await storeModel.StockMovement.findOne(storeModel.branchScopedQuery({
      type: 'CUSTOMER_RETURN',
      reference,
      sku: inventoryItem.sku,
    })).lean()
    if (!existingMovement) {
      await stockMovementService.adjustStock({
        sku: inventoryItem.sku,
        type: 'CUSTOMER_RETURN',
        quantity: item.quantity,
        reason: `Approved return for sale ${saleReturn.saleId}: ${saleReturn.reason}`,
        reference,
        user: auditActor().username || 'Sales Approver',
      })
    }
  }

  saleReturn.status = 'Approved'
  saleReturn.approvedBy = auditActor()
  saleReturn.approvedAt = new Date()
  await saleReturn.save()
  CacheManager.clear()
  return saleReturn.toObject()
}

async function rejectSaleReturn(id) {
  const saleReturn = await SaleReturn.findOne(storeModel.branchScopedQuery({ id }))
  if (!saleReturn) throw httpError(404, 'Return request not found')
  if (saleReturn.status !== 'Pending') throw httpError(409, 'Only pending returns can be rejected')
  saleReturn.status = 'Rejected'
  saleReturn.rejectedBy = auditActor()
  saleReturn.rejectedAt = new Date()
  await saleReturn.save()
  return saleReturn.toObject()
}

function validateSaleReturnItems(saleId, saleItems, existingReturns, requestedItems) {
  const remainingByKey = new Map()
  for (const item of saleItems) {
    const key = String(item.sku || item.item).trim().toLowerCase()
    remainingByKey.set(key, (remainingByKey.get(key) || 0) + Number(item.quantity || 0))
  }
  for (const existing of existingReturns.filter((row) => row.status !== 'Rejected')) {
    for (const item of existing.items || []) {
      const key = String(item.sku || item.item).trim().toLowerCase()
      remainingByKey.set(key, (remainingByKey.get(key) || 0) - Number(item.quantity || 0))
    }
  }

  const returnedItems = requestedItems.map((item) => {
    const sku = String(item.sku || '').trim()
    const name = String(item.item || '').trim()
    const match = saleItems.find((saleItem) =>
      (sku && String(saleItem.sku || '').trim().toLowerCase() === sku.toLowerCase())
      || (!sku && name && String(saleItem.item || '').trim().toLowerCase() === name.toLowerCase()))
    if (!match) throw httpError(400, `Item ${name || sku} is not part of sale ${saleId}`)
    const quantity = Number(item.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) throw httpError(400, 'Return quantities must be greater than zero')
    const key = String(match.sku || match.item).trim().toLowerCase()
    const remaining = remainingByKey.get(key) || 0
    if (quantity > remaining) throw httpError(400, `Return quantity exceeds the remaining quantity for ${match.item}`)
    remainingByKey.set(key, remaining - quantity)
    return { sku: String(match.sku || ''), item: String(match.item), quantity }
  })

  return [...returnedItems.reduce((items, item) => {
    const key = String(item.sku || item.item).trim().toLowerCase()
    const existing = items.get(key)
    if (existing) existing.quantity += item.quantity
    else items.set(key, { ...item })
    return items
  }, new Map()).values()]
}

module.exports = {
  listSales,
  getAvailableItems,
  normalizePaymentMethod,
  calculateSaleFinancials,
  createSale,
  bulkImportSales,
  updateSale,
  updateSaleStatus,
  createSaleReturn,
  listSaleReturns,
  approveSaleReturn,
  rejectSaleReturn,
  validateSaleReturnItems,
  deleteSale,
}

async function deleteSale(id) {
  const store = await storeModel.readStore()
  const index = store.sales.findIndex((row) => row.id === id)
  if (index === -1) throw httpError(404, 'Sale not found')

  const [sale] = store.sales.splice(index, 1)
  const lines = Array.isArray(sale.items) && sale.items.length ? sale.items : [{ sku: sale.sku, item: sale.item, quantity: sale.quantity }]
  const restored = []
  for (const line of lines) {
    const inventoryItem = findInventoryItem(store.inventory, line)
    const quantity = Number(line.quantity || 0)
    if (!inventoryItem || quantity <= 0) continue
    const previousStock = Number(inventoryItem.stock || 0)
    inventoryItem.stock = previousStock + quantity
    inventoryItem.status = inventoryStatus(inventoryItem.stock, inventoryItem)
    restored.push({ inventoryItem, quantity, previousStock })
  }

  await storeModel.writeStore(store)
  const Sale = require('../models/Sale')
  await Sale.deleteOne(sale._id ? { _id: sale._id } : storeModel.branchScopedQuery({ id }))

  for (const { inventoryItem, quantity, previousStock } of restored) {
    await stockMovementService.recordMovement({
      sku: inventoryItem.sku,
      type: 'ADJUSTMENT',
      quantity,
      previousStock,
      newStock: previousStock + quantity,
      reason: `Sale ${id} deleted; stock restored`,
      reference: id,
      warehouseCode: sale.warehouseCode || inventoryItem.defaultWarehouseCode || '',
    })
  }
  CacheManager.clear()
  return { success: true, id }
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
  existing.status = inventoryStatus(existing.stock, existing)
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
  existing.status = inventoryStatus(existing.stock, existing)
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

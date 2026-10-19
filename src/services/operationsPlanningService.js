const PlanningObjective = require('../models/PlanningObjective')
const PurchaseOrder = require('../models/PurchaseOrder')
const PurchaseRequest = require('../models/PurchaseRequest')
const ProductionConfiguration = require('../models/ProductionConfiguration')
const Supplier = require('../models/Supplier')
const storeModel = require('../models/storeModel')
const httpError = require('../utils/httpError')
const { auditActor } = require('../utils/tenantContext')
const { calculatePlan, createProductionOrder } = require('./productionService')
const { convertQuantity } = require('./unitConversionService')
const warehouseStockService = require('./warehouseStockService')

async function getOperationsData() {
  await storeModel.ensureStore()
  const [objectives, purchaseOrders] = await Promise.all([
    PlanningObjective.find(storeModel.branchScopedQuery()).sort({ createdAt: -1 }).lean(),
    PurchaseOrder.find(storeModel.branchScopedQuery()).sort({ createdAt: -1 }).lean(),
  ])
  return { objectives, purchaseOrders }
}

async function previewObjective(payload = {}) {
  return calculateObjectiveResult(payload)
}

async function createObjective(payload = {}) {
  await storeModel.ensureStore()
  const result = await calculateObjectiveResult(payload)
  const count = await PlanningObjective.countDocuments(storeModel.branchScopedQuery())
  const objective = await PlanningObjective.create(storeModel.withBranchFields({
    id: payload.id || `OBJ-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`,
    title: String(payload.title || payload.objective || 'Production objective').trim(),
    objective: String(payload.objective || '').trim(),
    scheduledDate: result.scheduledDate,
    targets: result.targets,
    result,
    status: 'CALCULATED',
  }))
  return objective.toObject()
}

async function convertObjectiveToPlans(id, payload = {}) {
  const objective = await PlanningObjective.findOne(storeModel.branchScopedQuery({ _id: id }))
  if (!objective) throw httpError(404, 'Planning objective not found')
  if (objective.status === 'CANCELLED') throw httpError(400, 'Cancelled objectives cannot be converted')
  const orders = []
  for (const target of objective.targets) {
    orders.push(await createProductionOrder({
      recipeId: target.recipeId,
      quantity: target.quantity,
      scheduledDate: payload.scheduledDate || objective.scheduledDate,
      notes: `Created from planning objective ${objective.id}`,
      submitForApproval: Boolean(payload.submitForApproval),
    }))
  }
  objective.status = 'CONVERTED'
  objective.convertedOrderIds = orders.map((order) => order.id)
  objective.updatedBy = auditActor()
  await objective.save()
  return { objective: objective.toObject(), orders }
}

async function calculateObjectiveResult(payload = {}) {
  const targets = normalizeTargets(payload.targets)
  if (!targets.length) throw httpError(400, 'Add at least one product target to the objective')
  const scheduledDate = normalizeDate(payload.scheduledDate) || new Date().toISOString().slice(0, 10)
  const plans = await Promise.all(targets.map(async (target) => {
    const plan = await calculatePlan({ recipeId: target.recipeId, quantity: target.quantity, scheduledDate })
    if (!plan.recipeApproved) throw httpError(400, `${plan.productName} needs an approved active recipe before planning`)
    return { ...plan, target }
  }))
  const requirements = await aggregateObjectiveRequirements(plans)
  const labor = aggregateRows(plans.flatMap((plan) => plan.labor), 'hours')
  const machines = aggregateRows(plans.flatMap((plan) => plan.machines), 'hours')
  const utilities = aggregateRows(plans.flatMap((plan) => plan.utilities), 'quantity')
  const cost = aggregateCost(plans.map((plan) => plan.cost))
  const salesValue = round(plans.reduce((total, plan) => total + Number(plan.target.sellingPrice || 0) * Number(plan.plannedQuantity || 0), 0))
  const totalMaterialInputQuantity = round(plans.reduce((total, plan) => total + Number(plan.totalMaterialInputQuantity || 0), 0))
  const expectedWasteQuantity = round(plans.reduce((total, plan) => total + Number(plan.expectedWasteQuantity || 0), 0))
  return {
    scheduledDate,
    targets: plans.map((plan) => ({ recipeId: plan.recipeId, productSku: plan.productSku, productName: plan.productName, quantity: plan.plannedQuantity, unit: plan.productUnit, sellingPrice: Number(plan.target.sellingPrice || 0) })),
    requirements,
    labor,
    machines,
    utilities,
    durationHours: round(plans.reduce((total, plan) => total + Number(plan.durationHours || 0), 0)),
    totalMaterialInputQuantity,
    expectedWasteQuantity,
    expectedWastePercent: totalMaterialInputQuantity > 0 ? round(expectedWasteQuantity / totalMaterialInputQuantity * 100) : 0,
    totalCost: cost.total,
    cost,
    salesValue,
    expectedProfit: round(salesValue - cost.total),
    assumptions: {
      stock: 'Current on-hand stock less reservations plus confirmed incoming stock.',
      costs: 'Uses approved recipes, configured resource rates, utility rates, transport, and overhead allocation.',
    },
  }
}

async function createManualPurchaseRequest(payload = {}) {
  await storeModel.ensureStore()
  const lines = normalizeRequestLines(payload.lines)
  if (!lines.length) throw httpError(400, 'Add at least one purchase request item')
  const count = await PurchaseRequest.countDocuments(storeModel.branchScopedQuery())
  const request = await PurchaseRequest.create(storeModel.withBranchFields({
    id: payload.id || `PR-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`,
    requiredByDate: normalizeDate(payload.requiredByDate),
    reason: String(payload.reason || '').trim(),
    notes: String(payload.notes || '').trim(),
    status: payload.status === 'DRAFT' ? 'DRAFT' : 'REQUESTED',
    lines,
    totalEstimatedCost: round(lines.reduce((total, line) => total + line.estimatedCost, 0)),
  }))
  return request.toObject()
}

async function approvePurchaseRequest(id) {
  const request = await PurchaseRequest.findOne(storeModel.branchScopedQuery({ _id: id }))
  if (!request) throw httpError(404, 'Purchase request not found')
  if (!['DRAFT', 'REQUESTED'].includes(request.status)) throw httpError(400, 'Only draft or requested purchase requests can be approved')
  await assertPurchaseRequestSeparation(request)
  request.status = 'APPROVED'
  request.approvedAt = new Date().toISOString().slice(0, 10)
  request.approvedBy = auditActor()
  request.updatedBy = auditActor()
  await request.save()
  return request.toObject()
}

async function rejectPurchaseRequest(id, payload = {}) {
  const request = await PurchaseRequest.findOne(storeModel.branchScopedQuery({ _id: id }))
  if (!request) throw httpError(404, 'Purchase request not found')
  if (!['DRAFT', 'REQUESTED'].includes(request.status)) throw httpError(400, 'Only draft or requested purchase requests can be rejected')
  await assertPurchaseRequestSeparation(request)
  request.status = 'REJECTED'
  request.rejectedAt = new Date().toISOString().slice(0, 10)
  request.rejectedBy = auditActor()
  request.rejectionReason = String(payload.reason || payload.notes || '').trim()
  request.updatedBy = auditActor()
  await request.save()
  return request.toObject()
}

async function listPurchaseOrders() {
  await storeModel.ensureStore()
  return PurchaseOrder.find(storeModel.branchScopedQuery()).sort({ createdAt: -1 }).lean()
}

async function createPurchaseOrder(payload = {}) {
  await storeModel.ensureStore()
  const order = await buildPurchaseOrder(payload)
  const count = await PurchaseOrder.countDocuments(storeModel.branchScopedQuery())
  const created = await PurchaseOrder.create(storeModel.withBranchFields({
    ...order,
    id: payload.id || `PO-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`,
    orderDate: normalizeDate(payload.orderDate) || new Date().toISOString().slice(0, 10),
    expectedDeliveryDate: normalizeDate(payload.expectedDeliveryDate),
    status: payload.submitForApproval ? 'PENDING_APPROVAL' : 'DRAFT',
  }))
  return created.toObject()
}

async function convertPurchaseRequestToOrders(id, payload = {}) {
  const request = await PurchaseRequest.findOne(storeModel.branchScopedQuery({ _id: id }))
  if (!request) throw httpError(404, 'Purchase request not found')
  if (request.status !== 'APPROVED') throw httpError(400, 'Approve the purchase request before creating purchase orders')
  const groups = new Map()
  request.lines.forEach((line) => {
    const supplierId = String(line.supplierId || payload.supplierId || '').trim()
    const supplierName = String(line.supplierName || payload.supplierName || '').trim()
    if (!supplierName) throw httpError(400, `Assign a supplier to ${line.item} before creating a purchase order`)
    const key = `${supplierId}:${supplierName.toLowerCase()}`
    const lines = groups.get(key) || { supplierId, supplierName, lines: [] }
    lines.lines.push({ sku: line.sku, item: line.item, quantity: line.purchaseQuantity, unit: line.purchaseUnit, unitPrice: line.estimatedUnitPrice, taxRate: 0 })
    groups.set(key, lines)
  })
  const orders = []
  for (const group of groups.values()) {
    orders.push(await createPurchaseOrder({
      purchaseRequestId: request.id,
      supplierId: group.supplierId,
      supplierName: group.supplierName,
      lines: group.lines,
      expectedDeliveryDate: request.requiredByDate,
      notes: `Created from purchase request ${request.id}`,
      submitForApproval: Boolean(payload.submitForApproval),
    }))
  }
  request.status = 'ORDERED'
  request.updatedBy = auditActor()
  await request.save()
  return orders
}

async function approvePurchaseOrder(id) {
  const order = await findPurchaseOrder(id)
  if (!['DRAFT', 'PENDING_APPROVAL'].includes(order.status)) throw httpError(400, 'Only draft or pending purchase orders can be approved')
  order.status = 'APPROVED'
  order.approvedAt = new Date().toISOString().slice(0, 10)
  order.approvedBy = auditActor()
  order.updatedBy = auditActor()
  await order.save()
  await Promise.all(order.lines.map((line) => warehouseStockService.recordStockOperation({
    operation: 'MARK_INCOMING',
    sku: line.sku,
    quantity: Number(line.quantity || 0),
    unit: line.unit,
    reference: order.id,
    partner: order.supplierName,
    reason: `Confirmed incoming stock from purchase order ${order.id}`,
  })))
  return order.toObject()
}

async function receivePurchaseOrder(id, payload = {}) {
  const order = await findPurchaseOrder(id)
  if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(order.status)) throw httpError(400, 'Approve the purchase order before receiving goods')
  const receipts = Array.isArray(payload.receipts) ? payload.receipts : []
  if (!receipts.length) throw httpError(400, 'Add at least one received item')
  const date = normalizeDate(payload.date) || new Date().toISOString().slice(0, 10)
  for (const receipt of receipts) {
    const line = order.lines.find((entry) => entry.sku === String(receipt.sku || '').trim())
    if (!line) throw httpError(400, 'Receipt item is not on this purchase order')
    const accepted = nonNegative(receipt.acceptedQuantity)
    const damaged = nonNegative(receipt.damagedQuantity)
    const rejected = nonNegative(receipt.rejectedQuantity)
    const outstanding = Math.max(0, Number(line.quantity || 0) - Number(line.receivedQuantity || 0) - Number(line.damagedQuantity || 0) - Number(line.rejectedQuantity || 0))
    if (accepted + damaged + rejected <= 0 || accepted + damaged + rejected > outstanding + 0.0001) throw httpError(400, `Receipt quantity for ${line.item} exceeds the outstanding quantity`)
    if (accepted > 0) {
      await warehouseStockService.recordStockOperation({
        operation: 'RECEIPT', sku: line.sku, quantity: accepted, unit: receipt.unit || line.unit,
        warehouseCode: receipt.warehouseCode, unitPrice: receipt.unitPrice ?? line.unitPrice,
        reference: order.id, partner: order.supplierName, batchNumber: receipt.batchNumber, expiryDate: receipt.expiryDate,
        reason: `Purchase order receipt ${order.id}`,
      })
    }
    if (damaged + rejected > 0) {
      await warehouseStockService.recordStockOperation({
        operation: 'CLEAR_INCOMING', sku: line.sku, quantity: damaged + rejected, unit: receipt.unit || line.unit,
        warehouseCode: receipt.warehouseCode, reference: order.id, partner: order.supplierName,
        reason: `Unaccepted quantity received against purchase order ${order.id}`,
      })
    }
    line.receivedQuantity = round(Number(line.receivedQuantity || 0) + accepted)
    line.damagedQuantity = round(Number(line.damagedQuantity || 0) + damaged)
    line.rejectedQuantity = round(Number(line.rejectedQuantity || 0) + rejected)
    order.receipts.push({ date, sku: line.sku, acceptedQuantity: accepted, damagedQuantity: damaged, rejectedQuantity: rejected, unit: receipt.unit || line.unit, unitPrice: Number(receipt.unitPrice ?? line.unitPrice ?? 0), warehouseCode: String(receipt.warehouseCode || ''), batchNumber: String(receipt.batchNumber || ''), expiryDate: normalizeDate(receipt.expiryDate), receivedBy: auditActor() })
  }
  const isComplete = order.lines.every((line) => Number(line.receivedQuantity || 0) + Number(line.damagedQuantity || 0) + Number(line.rejectedQuantity || 0) >= Number(line.quantity || 0))
  order.status = isComplete ? 'RECEIVED' : 'PARTIALLY_RECEIVED'
  order.receivedAt = date
  order.updatedBy = auditActor()
  await order.save()
  await updateSupplierPerformance(order, date, receipts)
  return order.toObject()
}

async function buildPurchaseOrder(payload = {}) {
  const supplierName = String(payload.supplierName || '').trim()
  if (!supplierName) throw httpError(400, 'Choose a supplier for the purchase order')
  const lines = normalizePurchaseOrderLines(payload.lines)
  if (!lines.length) throw httpError(400, 'Add at least one purchase order item')
  const subtotal = round(lines.reduce((total, line) => total + line.subtotal, 0))
  const tax = round(lines.reduce((total, line) => total + line.tax, 0))
  return { purchaseRequestId: String(payload.purchaseRequestId || '').trim(), supplierId: String(payload.supplierId || '').trim(), supplierName, lines, subtotal, tax, total: round(subtotal + tax), notes: String(payload.notes || '').trim() }
}

function normalizeRequestLines(lines = []) {
  return (Array.isArray(lines) ? lines : []).map((line) => {
    const purchaseQuantity = positive(line.purchaseQuantity ?? line.quantity)
    const price = nonNegative(line.estimatedUnitPrice ?? line.unitPrice)
    return {
      sku: String(line.sku || '').trim(), item: String(line.item || '').trim(), shortageQuantity: positive(line.shortageQuantity ?? purchaseQuantity),
      storageUnit: String(line.storageUnit || line.unit || 'piece').trim(), purchaseUnit: String(line.purchaseUnit || line.unit || 'piece').trim(), purchaseQuantity,
      packageSize: positive(line.packageSize ?? 1), packagesRequired: positive(line.packagesRequired ?? 1), supplierId: String(line.supplierId || '').trim(), supplierName: String(line.supplierName || '').trim(), estimatedUnitPrice: price, estimatedCost: round(purchaseQuantity * price),
    }
  }).filter((line) => line.sku && line.item && line.purchaseQuantity > 0)
}

function normalizePurchaseOrderLines(lines = []) {
  return (Array.isArray(lines) ? lines : []).map((line) => {
    const quantity = positive(line.quantity)
    const unitPrice = nonNegative(line.unitPrice)
    const taxRate = nonNegative(line.taxRate)
    const subtotal = round(quantity * unitPrice)
    const tax = round(subtotal * taxRate / 100)
    return { sku: String(line.sku || '').trim(), item: String(line.item || '').trim(), quantity, unit: String(line.unit || 'piece').trim(), unitPrice, taxRate, subtotal, tax, total: round(subtotal + tax) }
  }).filter((line) => line.sku && line.item && line.quantity > 0)
}

async function aggregateObjectiveRequirements(plans) {
  const grouped = new Map()
  for (const plan of plans) {
    for (const requirement of plan.requirements) {
      const key = `${requirement.sku}:${requirement.unit}`
      const current = grouped.get(key) || { ...requirement, baseRequiredQuantity: 0, wasteQuantity: 0, requiredQuantity: 0, materialCost: 0 }
      current.baseRequiredQuantity = round(current.baseRequiredQuantity + Number(requirement.baseRequiredQuantity ?? requirement.requiredQuantity ?? 0))
      current.wasteQuantity = round(current.wasteQuantity + Number(requirement.wasteQuantity || 0))
      current.requiredQuantity = round(current.requiredQuantity + Number(requirement.requiredQuantity || 0))
      current.materialCost = round(current.materialCost + Number(requirement.materialCost || 0))
      grouped.set(key, current)
    }
  }
  const rows = []
  for (const row of grouped.values()) {
    const projectedAvailableQuantity = round(Number(row.availableQuantity || 0) + Number(row.incomingQuantity || 0))
    const shortageQuantity = round(Math.max(0, row.requiredQuantity - projectedAvailableQuantity))
    const unrounded = shortageQuantity > 0 ? await convertQuantity({ quantity: shortageQuantity, fromUnit: row.unit, toUnit: row.purchaseUnit || row.unit, productSku: row.sku }).then((result) => result.quantity).catch(() => shortageQuantity) : 0
    const packageSize = positive(row.packageSize || 1)
    const packagesRequired = unrounded > 0 ? Math.ceil(unrounded / packageSize) : 0
    rows.push({ ...row, projectedAvailableQuantity, shortageQuantity, purchaseQuantity: round(packagesRequired * packageSize), packagesRequired, availabilityStatus: shortageQuantity > 0 ? 'PURCHASE_REQUIRED' : Number(row.availableQuantity || 0) >= row.requiredQuantity ? 'FULLY_AVAILABLE' : 'PARTIALLY_AVAILABLE' })
  }
  return rows
}

function aggregateRows(rows, quantityKey) {
  const grouped = new Map()
  rows.forEach((row) => {
    const current = grouped.get(row.name) || { ...row, [quantityKey]: 0, cost: 0 }
    current[quantityKey] = round(Number(current[quantityKey] || 0) + Number(row[quantityKey] || 0))
    current.cost = round(Number(current.cost || 0) + Number(row.cost || 0))
    grouped.set(row.name, current)
  })
  return [...grouped.values()]
}

function aggregateCost(costs) {
  const keys = ['material', 'packaging', 'labor', 'machine', 'utility', 'overhead', 'transport', 'waste', 'rework']
  const cost = keys.reduce((result, key) => ({ ...result, [key]: round(costs.reduce((total, entry) => total + Number(entry?.[key] || 0), 0)) }), {})
  return { ...cost, total: round(costs.reduce((total, entry) => total + Number(entry?.total || 0), 0)), unit: 0 }
}

async function assertPurchaseRequestSeparation(request) {
  const configuration = await ProductionConfiguration.findOne(storeModel.branchScopedQuery()).lean()
  const actor = auditActor()
  if (configuration?.separationOfDuties && actor.id && String(request.createdBy?.id || '') === actor.id) {
    throw httpError(403, 'Separation of duties is enabled: request creators cannot approve or reject their own purchase requests')
  }
}

async function findPurchaseOrder(id) {
  const order = await PurchaseOrder.findOne(storeModel.branchScopedQuery({ _id: id }))
  if (!order) throw httpError(404, 'Purchase order not found')
  return order
}

async function updateSupplierPerformance(order, receivedDate, receipts) {
  if (!order.supplierId) return
  const supplier = await Supplier.findOne({ ownerKey: order.ownerKey, _id: order.supplierId })
  if (!supplier) return
  const performance = supplier.deliveryPerformance || { deliveries: 0, onTime: 0, late: 0, rejectedQuantity: 0 }
  const receivedBefore = order.receipts.length === receipts.length
  if (receivedBefore) {
    performance.deliveries += 1
    if (order.expectedDeliveryDate && receivedDate > order.expectedDeliveryDate) performance.late += 1
    else performance.onTime += 1
  }
  performance.rejectedQuantity += receipts.reduce((total, receipt) => total + nonNegative(receipt.rejectedQuantity), 0)
  supplier.deliveryPerformance = performance
  await supplier.save()
}

function normalizeTargets(targets = []) {
  return (Array.isArray(targets) ? targets : []).map((target) => ({ recipeId: String(target.recipeId || '').trim(), quantity: positive(target.quantity), sellingPrice: nonNegative(target.sellingPrice) })).filter((target) => target.recipeId && target.quantity > 0)
}
function normalizeDate(value) { const date = String(value || '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '' }
function positive(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : 0 }
function nonNegative(value) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0 }
function round(value) { return Number(Number(value || 0).toFixed(4)) }

module.exports = { approvePurchaseOrder, approvePurchaseRequest, calculateObjectiveResult, convertObjectiveToPlans, convertPurchaseRequestToOrders, createManualPurchaseRequest, createObjective, createPurchaseOrder, getOperationsData, listPurchaseOrders, previewObjective, receivePurchaseOrder, rejectPurchaseRequest }

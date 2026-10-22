const mongoose = require('mongoose')
const { randomUUID } = require('node:crypto')
const ProductionConfiguration = require('../models/ProductionConfiguration')
const ProductionOrder = require('../models/ProductionOrder')
const ProductionProcess = require('../models/ProductionProcess')
const WasteRecord = require('../models/WasteRecord')
const PurchaseRequest = require('../models/PurchaseRequest')
const Recipe = require('../models/Recipe')
const storeModel = require('../models/storeModel')
const CacheManager = require('../utils/cache')
const httpError = require('../utils/httpError')
const { calculateProductionPlan, calculateWasteMetrics } = require('../utils/productionCalculator')
const { normalizeQualityOutcome } = require('../utils/qualityEvaluation')
const { auditActor, currentBranchCode } = require('../utils/tenantContext')
const { assertUnitExists, convertItemQuantity, convertQuantity, normalizeUnitCode, listUnits } = require('./unitConversionService')
const warehouseStockService = require('./warehouseStockService')

const DEFAULT_CONFIGURATION = {
  units: ['piece', 'kg', 'litre', 'hour', 'batch'],
  conversions: [],
  workers: [],
  machines: [],
  utilities: [],
  overheadCosts: [],
  overheadRatePerUnit: 0,
  transportCostPerBatch: 0,
  separationOfDuties: false,
}

const ORDER_STATUSES = new Set(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PLANNED', 'MATERIALS_READY', 'IN_PROGRESS', 'PAUSED', 'QUALITY_CHECK', 'REWORK', 'ON_HOLD', 'CANCELLED'])
let recipeIndexMigration

async function getOverview() {
  await storeModel.ensureStore()
  await ensureRecipeIndexes()
  const [rawRecipes, orders, processes, purchaseRequests, configuration, store, balances] = await Promise.all([
    Recipe.find(storeModel.branchScopedQuery()).sort({ productSku: 1, version: -1, createdAt: -1 }).lean(),
    ProductionOrder.find(storeModel.branchScopedQuery()).sort({ scheduledDate: -1, createdAt: -1 }).lean(),
    ProductionProcess.find(storeModel.branchScopedQuery()).sort({ name: 1 }).lean(),
    PurchaseRequest.find(storeModel.branchScopedQuery()).sort({ createdAt: -1 }).lean(),
    loadConfiguration(),
    storeModel.readStore(),
    warehouseStockService.listBalances(),
  ])
  const recipes = rawRecipes.map(serializeRecipe)
  const inventory = buildInventoryAvailability(store.inventory, balances)

  return {
    recipes,
    orders,
    processes,
    purchaseRequests,
    configuration,
    inventory: inventory.map(serializeInventory),
    metrics: {
      activeRecipes: recipes.filter((recipe) => recipe.active && recipe.approvalStatus === 'APPROVED').length,
      openOrders: orders.filter((order) => !['COMPLETED', 'CANCELLED'].includes(order.status)).length,
      qualityHoldCount: orders.filter((order) => order.status === 'ON_HOLD').length,
      completedOrders: orders.filter((order) => order.status === 'COMPLETED').length,
      purchaseRequestCount: purchaseRequests.filter((request) => request.status !== 'CANCELLED').length,
    },
  }
}

async function listRecipes() {
  await storeModel.ensureStore()
  await ensureRecipeIndexes()
  const recipes = await Recipe.find(storeModel.branchScopedQuery()).sort({ productSku: 1, version: -1, createdAt: -1 }).lean()
  return recipes.map(serializeRecipe)
}

async function createRecipe(payload = {}) {
  await storeModel.ensureStore()
  await ensureRecipeIndexes()
  const recipe = buildRecipe(payload)
  await validateRecipeUnits(recipe)
  await assertProcessAvailable(recipe.processId)
  recipe.version = await nextRecipeVersion(recipe.productSku)
  recipe.versionLabel = recipe.versionLabel || `v${recipe.version}`
  recipe.approvalStatus = payload.submitForApproval ? 'PENDING_APPROVAL' : 'DRAFT'
  recipe.active = false
  await ensureFinishedProduct(recipe)
  const created = await Recipe.create(storeModel.withBranchFields(recipe))
  CacheManager.clear()
  return serializeRecipe(created.toObject())
}

async function updateRecipe(id, payload = {}) {
  await storeModel.ensureStore()
  const recipe = await Recipe.findOne(storeModel.branchScopedQuery({ _id: id }))
  if (!recipe) throw httpError(404, 'Recipe not found')
  if (effectiveApprovalStatus(recipe) === 'APPROVED') {
    throw httpError(400, 'Approved recipes are locked. Create a new version to change this BOM.')
  }

  const next = buildRecipe({ ...recipe.toObject(), ...payload }, recipe.toObject())
  if (next.productSku !== recipe.productSku) throw httpError(400, 'A recipe product SKU cannot be changed after creation')
  next.version = recipe.version || 1
  next.versionLabel = recipe.versionLabel || `v${next.version}`
  next.approvalStatus = payload.submitForApproval ? 'PENDING_APPROVAL' : effectiveApprovalStatus(recipe)
  next.active = false
  await validateRecipeUnits(next)
  await assertProcessAvailable(next.processId)
  await ensureFinishedProduct(next)
  Object.assign(recipe, next, { updatedBy: auditActor() })
  await recipe.save()
  CacheManager.clear()
  return serializeRecipe(recipe.toObject())
}

async function approveRecipe(id) {
  await storeModel.ensureStore()
  await ensureRecipeIndexes()
  const recipe = await Recipe.findOne(storeModel.branchScopedQuery({ _id: id }))
  if (!recipe) throw httpError(404, 'Recipe not found')
  if (effectiveApprovalStatus(recipe) === 'REJECTED') throw httpError(400, 'Rejected recipes must be revised before approval')

  await Recipe.updateMany(
    storeModel.branchScopedQuery({ productSku: recipe.productSku, _id: { $ne: recipe._id } }),
    { $set: { active: false } }
  )
  recipe.approvalStatus = 'APPROVED'
  recipe.active = true
  recipe.approvedAt = new Date().toISOString().slice(0, 10)
  recipe.approvedBy = auditActor()
  recipe.updatedBy = auditActor()
  await recipe.save()
  CacheManager.clear()
  return serializeRecipe(recipe.toObject())
}

async function calculatePlan({ recipeId, productSku, quantity, scheduledDate }) {
  await storeModel.ensureStore()
  const recipe = await findRecipe({ recipeId, productSku }, false)
  const [store, configuration, balances, orders] = await Promise.all([
    storeModel.readStore(),
    loadConfiguration(),
    warehouseStockService.listBalances(),
    ProductionOrder.find(storeModel.branchScopedQuery({ status: { $nin: ['COMPLETED', 'CANCELLED'] } })).lean(),
  ])
  const inventory = buildInventoryAvailability(store.inventory, balances)
  const recipeWithProcess = await resolveRecipeProcess(recipe)
  const preparedRecipe = await prepareRecipeForStorage(recipeWithProcess, inventory)
  const calculated = calculateProductionPlan(preparedRecipe, inventory, configuration, quantity)
  const requirements = await enrichRequirementsForPurchasing(calculated.requirements, recipeWithProcess, inventory)
  const date = normalizeDate(scheduledDate) || new Date().toISOString().slice(0, 10)
  const scheduleWarnings = calculateScheduleWarnings({ configuration, orders, recipe: recipeWithProcess, scheduledDate: date })
  return {
    recipeId: String(recipe._id),
    recipeVersion: Number(recipe.version || 1),
    recipeApproved: effectiveApprovalStatus(recipe) === 'APPROVED' && recipe.active !== false,
    ...calculated,
    requirements,
    estimatedEndDate: addHoursToDate(date, calculated.durationHours),
    scheduleWarnings,
    assumptions: {
      branchCode: currentBranchCode(),
      scheduledDate: date,
      stockBasis: 'Available stock is on-hand less reserved stock; confirmed incoming stock is added before shortages are calculated.',
      purchaseRounding: 'Purchase quantities are rounded up to the preferred supplier package size.',
      valuationMethod: 'Weighted-average item cost is used for material estimates.',
    },
  }
}

async function listOrders() {
  await storeModel.ensureStore()
  return ProductionOrder.find(storeModel.branchScopedQuery()).sort({ scheduledDate: -1, createdAt: -1 }).lean()
}

async function createProductionOrder(payload = {}) {
  await storeModel.ensureStore()
  const recipe = await findRecipe(payload, true)
  const plan = await calculatePlan({ recipeId: String(recipe._id), quantity: payload.quantity, scheduledDate: payload.scheduledDate })
  const count = await ProductionOrder.countDocuments(storeModel.branchScopedQuery())
  const order = await ProductionOrder.create(storeModel.withBranchFields({
    id: payload.id || `PROD-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`,
    recipeId: String(recipe._id),
    recipeVersion: Number(recipe.version || 1),
    productSku: recipe.productSku,
    productName: recipe.productName,
    productUnit: recipe.productUnit,
    servingSize: recipe.servingSize || 0,
    servingUnit: recipe.servingUnit || '',
    plannedQuantity: plan.plannedQuantity,
    status: payload.submitForApproval ? 'PENDING_APPROVAL' : 'DRAFT',
    warehouseCode: String(payload.warehouseCode || '').trim().toUpperCase(),
    scheduledDate: plan.assumptions.scheduledDate,
    plannedEndDate: plan.estimatedEndDate,
    expectedDurationHours: plan.durationHours,
    expectedWastePercent: plan.expectedWastePercent,
    expectedWasteQuantity: plan.expectedWasteQuantity,
    totalMaterialInputQuantity: plan.totalMaterialInputQuantity,
    requirements: plan.requirements.map(({ materialCost, substitutes, ...requirement }) => requirement),
    planningAssumptions: plan.assumptions,
    scheduleWarnings: plan.scheduleWarnings,
    cost: plan.cost,
    notes: String(payload.notes || '').trim(),
  }))
  return order.toObject()
}

async function approveProductionOrder(id) {
  await storeModel.ensureStore()
  const order = await findOrder(id)
  if (!['DRAFT', 'PENDING_APPROVAL'].includes(order.status)) throw httpError(400, 'Only draft or pending production plans can be approved')
  const plan = await calculatePlan({ recipeId: order.recipeId, quantity: order.plannedQuantity, scheduledDate: order.scheduledDate })
  order.status = 'APPROVED'
  order.plannedEndDate = plan.estimatedEndDate
  order.expectedDurationHours = plan.durationHours
  order.expectedWastePercent = plan.expectedWastePercent
  order.expectedWasteQuantity = plan.expectedWasteQuantity
  order.totalMaterialInputQuantity = plan.totalMaterialInputQuantity
  order.requirements = plan.requirements.map(({ materialCost, substitutes, ...requirement }) => requirement)
  order.planningAssumptions = plan.assumptions
  order.scheduleWarnings = plan.scheduleWarnings
  order.cost = plan.cost
  order.approvedAt = new Date().toISOString().slice(0, 10)
  order.approvedBy = auditActor()
  order.updatedBy = auditActor()
  await order.save()
  return order.toObject()
}

async function reserveProductionOrderMaterials(id, payload = {}) {
  await storeModel.ensureStore()
  const order = await findOrder(id)
  if (!['APPROVED', 'PLANNED', 'MATERIALS_READY'].includes(order.status)) {
    throw httpError(400, 'Approve the production order before reserving materials')
  }
  if (order.materialReservations.length > 0) return order.toObject()

  const store = await storeModel.readStore()
  const reservations = []
  for (const requirement of order.requirements) {
    const item = store.inventory.find((entry) => entry.sku === requirement.sku)
    if (!item) throw httpError(400, `Material ${requirement.item} is no longer in inventory`)
    const warehouseCode = String(payload.warehouseCode || order.warehouseCode || item.defaultWarehouseCode || '').trim().toUpperCase()
    await warehouseStockService.recordStockOperation({
      operation: 'RESERVE',
      sku: item.sku,
      quantity: Number(requirement.requiredQuantity || 0),
      unit: item.baseUnit || requirement.unit,
      warehouseCode,
      reference: order.id,
      reason: `Reserved for production order ${order.id}`,
    })
    reservations.push({ sku: item.sku, warehouseCode, quantity: Number(requirement.requiredQuantity || 0), unit: item.baseUnit || requirement.unit, reservedAt: new Date().toISOString().slice(0, 10) })
  }
  order.materialReservations = reservations
  order.status = 'MATERIALS_READY'
  order.updatedBy = auditActor()
  await order.save()
  return order.toObject()
}

async function updateProductionOrder(id, payload = {}) {
  await storeModel.ensureStore()
  const order = await findOrder(id)
  if (order.status === 'COMPLETED' || order.status === 'REJECTED') throw httpError(400, 'Completed or rejected production orders cannot be changed')
  if (payload.status !== undefined) {
    const status = String(payload.status).trim().toUpperCase()
    if (!ORDER_STATUSES.has(status)) throw httpError(400, 'Use a quality inspection to complete a production order')
    await assertOrderTransition(order, status)
    order.status = status
    if (status === 'IN_PROGRESS' && !order.startedAt) order.startedAt = new Date().toISOString().slice(0, 10)
    if (status === 'PAUSED') order.pausedAt = new Date().toISOString().slice(0, 10)
  }
  if (payload.scheduledDate !== undefined) order.scheduledDate = normalizeDate(payload.scheduledDate) || order.scheduledDate
  if (payload.notes !== undefined) order.notes = String(payload.notes)
  order.updatedBy = auditActor()
  await order.save()
  return order.toObject()
}

async function recordProductionExecution(id, payload = {}) {
  await storeModel.ensureStore()
  const order = await findOrder(id)
  if (order.completedAt) throw httpError(400, 'This production run has already been completed or quarantined')
  if (!['IN_PROGRESS', 'PAUSED', 'REWORK', 'QUALITY_CHECK'].includes(order.status)) {
    throw httpError(400, 'Start the production order before recording actual usage')
  }
  const [store, configuration] = await Promise.all([storeModel.readStore(), loadConfiguration()])
  const inventoryBySku = new Map(store.inventory.map((item) => [item.sku, item]))
  const requirementsBySku = new Map(order.requirements.map((requirement) => [requirement.sku, requirement]))
  let materialInput = Array.isArray(payload.actualMaterials) ? payload.actualMaterials : order.actualMaterials
  if (!materialInput.length) {
    materialInput = order.requirements.map((requirement) => ({
      sku: requirement.sku,
      quantity: requirement.requiredQuantity,
      unit: requirement.unit,
    }))
  }
  const actualMaterials = []
  for (const row of materialInput || []) {
    const sku = String(row.sku || '').trim()
    const item = inventoryBySku.get(sku)
    if (!item) throw httpError(400, `Actual material ${sku || 'item'} was not found in inventory`)
    const inputQuantity = positiveNumber(row.quantity, 0)
    if (inputQuantity <= 0) continue
    const conversion = await convertItemQuantity(item, inputQuantity, row.unit || item.baseUnit)
    const unitCost = positiveNumber(row.unitCost, positiveNumber(item.purchasePrice ?? item.price, 0))
    actualMaterials.push({ sku, item: item.item, quantity: conversion.quantity, unit: item.baseUnit || conversion.unit, unitCost, cost: round(conversion.quantity * unitCost) })
  }
  const outputQuantity = positiveNumber(payload.actualOutput, order.originalActualOutput || order.plannedQuantity)
  const batches = Math.max(1, positiveNumber(order.plannedQuantity, 1) / Math.max(1, outputQuantity))
  const actualLabor = normalizeActualLabor(payload.labor ?? order.actualLabor, configuration.workers, outputQuantity, batches)
  const actualMachines = normalizeActualMachines(payload.machines ?? order.actualMachines, configuration.machines, outputQuantity, batches)
  const actualUtilities = normalizeActualUtilities(payload.utilities ?? order.actualUtilities, configuration.utilities)
  const totalInputCost = round(actualMaterials.reduce((total, row) => total + row.cost, 0))
  const rawPackagingCost = round(actualMaterials.filter((row) => requirementsBySku.get(row.sku)?.materialType === 'packaging').reduce((total, row) => total + row.cost, 0))
  const totalMaterialInput = round(actualMaterials.reduce((total, row) => total + row.quantity, 0))
  const actualWaste = positiveNumber(payload.actualWaste, order.actualWaste)
  const actualWasteReason = String(payload.actualWasteReason ?? order.actualWasteReason ?? '').trim()
  if (actualWaste > 0 && !actualWasteReason) throw httpError(400, 'A reason is required when actual waste is recorded')
  if (actualWaste > totalMaterialInput) throw httpError(400, 'Actual waste cannot exceed total material input')
  const wasteMetrics = calculateWasteMetrics(totalMaterialInput, order.expectedWastePercent, actualWaste)
  const waste = totalMaterialInput > 0 ? round(totalInputCost * actualWaste / totalMaterialInput) : 0
  const packaging = round(rawPackagingCost * (1 - (totalInputCost > 0 ? waste / totalInputCost : 0)))
  const material = round(totalInputCost - waste - packaging)
  const labor = round(actualLabor.reduce((total, row) => total + row.cost, 0))
  const machine = round(actualMachines.reduce((total, row) => total + row.cost, 0))
  const utility = round(actualUtilities.reduce((total, row) => total + row.cost, 0))
  const overhead = positiveNumber(order.cost?.overhead, 0)
  const transport = positiveNumber(order.cost?.transport, 0)
  const rework = order.status === 'REWORK' ? round(labor + machine + utility) : 0
  const total = round(material + labor + machine + utility + overhead + transport + waste + rework)
  const actualCost = { material, packaging, labor, machine, utility, overhead, transport, waste, rework, total, unit: round(total / Math.max(1, outputQuantity)) }
  const reusableWaste = Boolean(payload.reusableWaste)
  const reusableWasteQuantity = positiveNumber(payload.reusableWasteQuantity, 0)
  const reusableWasteUnit = String(payload.reusableWasteUnit || '').trim()
  if (actualWaste > 0 && reusableWaste && (reusableWasteQuantity <= 0 || !reusableWasteUnit)) {
    throw httpError(400, 'Reusable waste requires a positive recoverable quantity and unit')
  }
  const postedWaste = await WasteRecord.exists(storeModel.branchScopedQuery({ productionOrderId: String(order._id), status: 'POSTED' }))
  if (postedWaste) throw httpError(400, 'Production actuals cannot be changed after waste or by-products have been posted to inventory')

  order.actualMaterials = actualMaterials
  order.actualLabor = actualLabor
  order.actualMachines = actualMachines
  order.actualUtilities = actualUtilities
  order.byProducts = normalizeByProducts(payload.byProducts ?? order.byProducts)
  order.actualWaste = actualWaste
  order.actualWastePercent = wasteMetrics.actualWastePercent
  order.totalMaterialInputQuantity = totalMaterialInput
  order.actualWasteReason = actualWasteReason
  order.productionTimeHours = positiveNumber(payload.productionTimeHours, order.productionTimeHours)
  order.actualCost = actualCost
  order.costVariance = calculateCostVariance(actualCost, order.cost || {})
  order.updatedBy = auditActor()
  await order.save()
  await recordProductionWasteRecords(order, {
    actualWaste,
    actualWasteReason,
    reusableWaste,
    reusableWasteSku: String(payload.reusableWasteSku || '').trim(),
    reusableWasteQuantity,
    reusableWasteUnit,
    byProducts: order.byProducts,
  })
  await updateMachineOperatingHours(actualMachines)
  return order.toObject()
}

async function recordProductionWasteRecords(order, payload, { preserveExisting = false } = {}) {
  const scope = storeModel.branchScopedQuery({ productionOrderId: String(order._id) })
  const actor = auditActor()
  if (payload.actualWaste > 0) {
    const id = `${order.id}-WASTE`
    const query = storeModel.branchScopedQuery({ productionOrderId: String(order._id), kind: 'WASTE', sku: '' })
    const existing = preserveExisting ? await WasteRecord.findOne(query).lean() : null
    if (!existing) await WasteRecord.findOneAndUpdate(
      query,
      {
        $set: {
          productionOrderCode: order.id,
          productSku: order.productSku,
          productName: order.productName,
          quantity: payload.actualWaste,
          unit: 'material-input-unit',
          reason: payload.actualWasteReason,
          reusable: payload.reusableWaste,
          inventorySku: payload.reusableWasteSku,
          inventoryQuantity: payload.reusableWasteQuantity,
          inventoryUnit: payload.reusableWasteUnit,
          status: payload.reusableWaste ? 'PENDING_APPROVAL' : 'RECORDED',
          updatedBy: actor,
        },
        $setOnInsert: {
          ...storeModel.withBranchFields({ id, productionOrderId: String(order._id), kind: 'WASTE', sku: '' }),
          createdBy: actor,
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    )
  } else if (!preserveExisting) {
    await WasteRecord.updateMany(
      storeModel.branchScopedQuery({ productionOrderId: String(order._id), kind: 'WASTE', status: { $ne: 'POSTED' } }),
      { $set: { quantity: 0, status: 'RECORDED', updatedBy: actor } }
    )
  }

  const products = payload.byProducts || []
  const productSkus = products.map((row) => row.sku)
  if (!preserveExisting) {
    await WasteRecord.updateMany(
      { ...scope, kind: 'BYPRODUCT', status: { $ne: 'POSTED' }, sku: { $nin: productSkus } },
      { $set: { quantity: 0, status: 'RECORDED', updatedBy: actor } }
    )
  }
  for (const product of products) {
    const id = `${order.id}-BYPRODUCT-${product.sku}`
    const query = storeModel.branchScopedQuery({ productionOrderId: String(order._id), kind: 'BYPRODUCT', sku: product.sku })
    const existing = preserveExisting ? await WasteRecord.findOne(query).lean() : null
    if (existing) continue
    await WasteRecord.findOneAndUpdate(
      query,
      {
        $set: {
          productionOrderCode: order.id,
          productSku: order.productSku,
          productName: order.productName,
          item: product.item,
          quantity: product.quantity,
          unit: product.unit,
          reason: product.notes,
          reusable: true,
          inventorySku: product.sku,
          inventoryQuantity: product.quantity,
          inventoryUnit: product.unit,
          notes: product.notes,
          status: 'PENDING_APPROVAL',
          updatedBy: actor,
        },
        $setOnInsert: {
          ...storeModel.withBranchFields({ id, productionOrderId: String(order._id), kind: 'BYPRODUCT', sku: product.sku }),
          createdBy: actor,
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    )
  }
}

async function listWasteRecords() {
  await storeModel.ensureStore()
  return WasteRecord.find(storeModel.branchScopedQuery()).sort({ createdAt: -1 }).lean()
}

async function approveWasteRecord(id, payload = {}) {
  await storeModel.ensureStore()
  const record = await WasteRecord.findOne(storeModel.branchScopedQuery({ _id: id }))
  if (!record) throw httpError(404, 'Waste or by-product record not found')
  if (record.status === 'POSTED') return record.toObject()
  if (!['PENDING_APPROVAL', 'APPROVED'].includes(record.status)) throw httpError(400, 'This record is not awaiting approval')
  const order = await findOrder(record.productionOrderId)
  if (order.status !== 'COMPLETED') throw httpError(400, 'Reusable waste and by-products can only be approved after a passing production completion')
  if (record.kind === 'WASTE' && !record.reusable) throw httpError(400, 'Non-reusable waste cannot be added to inventory')

  const inventorySku = String(payload.inventorySku || record.inventorySku || record.sku).trim()
  const inventoryQuantity = positiveNumber(payload.inventoryQuantity, record.inventoryQuantity)
  const inventoryUnit = String(payload.inventoryUnit || record.inventoryUnit || record.unit).trim()
  if (!inventorySku || inventoryQuantity <= 0 || !inventoryUnit) {
    throw httpError(400, 'Choose an inventory item and positive quantity before approving reusable waste')
  }
  const store = await storeModel.readStore()
  const inventoryItem = store.inventory.find((item) => item.sku === inventorySku)
  if (!inventoryItem) throw httpError(400, 'The selected inventory item does not exist in this branch')

  record.inventorySku = inventorySku
  record.inventoryQuantity = inventoryQuantity
  record.inventoryUnit = inventoryUnit
  record.status = 'APPROVED'
  record.approvedAt = new Date().toISOString()
  record.approvedBy = auditActor()
  record.updatedBy = auditActor()
  await record.save()

  const movementReference = `WASTE-APPROVAL:${record.id}`
  const existingMovement = await storeModel.StockMovement.findOne(storeModel.branchScopedQuery({ reference: movementReference })).lean()
  if (!existingMovement) {
    await warehouseStockService.recordStockOperation({
      operation: 'PRODUCTION_OUTPUT',
      sku: inventorySku,
      quantity: inventoryQuantity,
      unit: inventoryUnit,
      warehouseCode: order.warehouseCode || inventoryItem.defaultWarehouseCode,
      unitPrice: Number(inventoryItem.purchasePrice ?? inventoryItem.price ?? 0),
      date: new Date().toISOString().slice(0, 10),
      reference: movementReference,
      batchNumber: order.id,
      reason: `${record.kind === 'BYPRODUCT' ? 'Approved by-product' : 'Approved reusable waste'} from production order ${order.id}`,
    })
  }
  record.status = 'POSTED'
  record.postedAt = new Date().toISOString()
  record.updatedBy = auditActor()
  await record.save()
  CacheManager.clear()
  return record.toObject()
}

async function listProcesses() {
  await storeModel.ensureStore()
  return ProductionProcess.find(storeModel.branchScopedQuery()).sort({ active: -1, name: 1 }).lean()
}

async function createProcess(payload = {}) {
  await storeModel.ensureStore()
  const count = await ProductionProcess.countDocuments(storeModel.branchScopedQuery())
  const process = buildProcess({ ...payload, code: payload.code || `PROCESS-${String(count + 1).padStart(3, '0')}` })
  await validateProcessUnits(process)
  try {
    const created = await ProductionProcess.create(storeModel.withBranchFields(process))
    return created.toObject()
  } catch (error) {
    if (error?.code === 11000) throw httpError(409, 'A production process with this code already exists')
    throw error
  }
}

async function updateProcess(id, payload = {}) {
  await storeModel.ensureStore()
  const process = await ProductionProcess.findOne(storeModel.branchScopedQuery({ _id: id }))
  if (!process) throw httpError(404, 'Production process not found')
  const next = buildProcess({ ...process.toObject(), ...payload }, process.toObject())
  if (next.code !== process.code) throw httpError(400, 'A process code cannot be changed after creation')
  await validateProcessUnits(next)
  Object.assign(process, next, { updatedBy: auditActor() })
  await process.save()
  return process.toObject()
}

async function listPurchaseRequests() {
  await storeModel.ensureStore()
  return PurchaseRequest.find(storeModel.branchScopedQuery()).sort({ createdAt: -1 }).lean()
}

async function createPurchaseRequest(payload = {}) {
  await storeModel.ensureStore()
  let plan
  let order = null
  if (payload.productionOrderId) {
    order = await findOrder(payload.productionOrderId)
    plan = { recipeId: order.recipeId, productName: order.productName, plannedQuantity: order.plannedQuantity, requirements: order.requirements, assumptions: order.planningAssumptions || {} }
  } else {
    plan = await calculatePlan(payload)
  }
  const shortageLines = plan.requirements.filter((row) => Number(row.shortageQuantity || 0) > 0)
  if (shortageLines.length === 0) throw httpError(400, 'This production plan has no purchase shortages')
  const count = await PurchaseRequest.countDocuments(storeModel.branchScopedQuery())
  const lines = shortageLines.map((row) => ({
    sku: row.sku, item: row.item, shortageQuantity: Number(row.shortageQuantity || 0), storageUnit: row.unit,
    purchaseUnit: row.purchaseUnit || row.unit, purchaseQuantity: Number(row.purchaseQuantity || row.shortageQuantity || 0),
    packageSize: Number(row.packageSize || 1), packagesRequired: Number(row.packagesRequired || 0), supplierId: row.supplierId || '', supplierName: row.supplierName || '',
    estimatedUnitPrice: Number(row.purchaseUnitPrice || row.unitCost || 0), estimatedCost: Number(row.purchaseCost || row.materialCost || 0),
  }))
  const request = await PurchaseRequest.create(storeModel.withBranchFields({
    id: payload.id || `PR-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`,
    productionOrderId: order?.id || '', recipeId: String(plan.recipeId), productName: plan.productName || '', plannedQuantity: Number(plan.plannedQuantity || 0),
    requiredByDate: payload.requiredByDate || order?.scheduledDate || plan.assumptions?.scheduledDate || '', status: payload.status === 'DRAFT' ? 'DRAFT' : 'REQUESTED',
    lines, totalEstimatedCost: round(lines.reduce((total, line) => total + line.estimatedCost, 0)), notes: String(payload.notes || '').trim(),
  }))
  return request.toObject()
}

async function updatePurchaseRequest(id, payload = {}) {
  await storeModel.ensureStore()
  const request = await PurchaseRequest.findOne(storeModel.branchScopedQuery({ _id: id }))
  if (!request) throw httpError(404, 'Purchase request not found')
  const status = String(payload.status || '').trim().toUpperCase()
  if (status && !['DRAFT', 'REQUESTED', 'CANCELLED'].includes(status)) throw httpError(400, 'Use the approval or rejection actions for purchase request decisions')
  if (status) request.status = status
  if (payload.notes !== undefined) request.notes = String(payload.notes)
  request.updatedBy = auditActor()
  await request.save()
  return request.toObject()
}

async function recordQualityInspection(id, payload) {
  await storeModel.ensureStore()
  const order = await findOrder(id)
  if (!['IN_PROGRESS', 'QUALITY_CHECK', 'ON_HOLD', 'REWORK'].includes(order.status)) throw httpError(400, 'Start an approved production order before recording quality')
  if (order.completedAt) throw httpError(400, 'This production run has already been completed or quarantined')
  const result = normalizeQualityOutcome(payload.result)
  const inspection = { date: payload.date || new Date().toISOString().slice(0, 10), result, notes: String(payload.notes || '').trim(), inspectedBy: auditActor().username || String(payload.inspectedBy || 'System').trim() || 'System' }
  order.qualityInspections.push(inspection)
  order.updatedBy = auditActor()
  if (result === 'PASS') return completeProductionOrder(order, payload)
  if (result === 'REWORK') { order.status = 'REWORK'; await order.save(); return order.toObject() }
  return completeProductionOrder(order, {
    ...payload,
    quarantineOutput: payload.quarantineFailedOutput !== false,
    qualityOutcome: result,
  })
}

async function applyQualityResult(id, result, payload = {}) {
  await storeModel.ensureStore()
  const order = await findOrder(id)
  if (!['IN_PROGRESS', 'QUALITY_CHECK', 'ON_HOLD', 'REWORK'].includes(order.status)) {
    throw httpError(400, 'Production order is not awaiting a quality decision')
  }
  if (order.completedAt) throw httpError(400, 'This production run has already been completed or quarantined')
  const normalized = normalizeQualityOutcome(result)
  const inspection = {
    date: payload.date || new Date().toISOString().slice(0, 10),
    result: normalized,
    notes: String(payload.notes || '').trim(),
    inspectedBy: auditActor().username || 'System',
  }
  order.qualityInspections.push(inspection)
  order.updatedBy = auditActor()
  if (normalized === 'PASS') return completeProductionOrder(order, payload)
  if (normalized === 'REWORK') {
    order.status = 'REWORK'
    await order.save()
    return order.toObject()
  }
  return completeProductionOrder(order, {
    ...payload,
    quarantineOutput: payload.quarantineFailedOutput !== false,
    qualityOutcome: normalized,
  })
}

async function completeProductionOrder(order, payload) {
  const originalActualOutput = positiveNumber(payload.actualOutput, order.plannedQuantity)
  if (originalActualOutput <= 0) throw httpError(400, 'Actual output must be greater than 0')
  const store = await storeModel.readStore()
  const date = payload.date || new Date().toISOString().slice(0, 10)
  const requirementBySku = new Map(order.requirements.map((requirement) => [requirement.sku, requirement]))
  const materialRows = order.actualMaterials?.length
    ? order.actualMaterials
    : order.requirements.map((requirement) => ({ sku: requirement.sku, item: requirement.item, quantity: requirement.requiredQuantity, unit: requirement.unit }))
  const actualWaste = positiveNumber(payload.actualWaste, order.actualWaste)
  const actualWasteReason = String(payload.actualWasteReason ?? order.actualWasteReason ?? '').trim()
  const totalMaterialInput = round(materialRows.reduce((total, row) => total + positiveNumber(row.quantity, 0), 0))
  if (actualWaste > 0 && !actualWasteReason) throw httpError(400, 'A reason is required when actual waste is recorded')
  if (actualWaste > totalMaterialInput) throw httpError(400, 'Actual waste cannot exceed total material input')
  const wasteMetrics = calculateWasteMetrics(totalMaterialInput, order.expectedWastePercent, actualWaste)
  const consumedBySku = new Map()
  for (const row of materialRows) {
    const requirement = requirementBySku.get(row.sku)
    const item = store.inventory.find((entry) => entry.sku === row.sku)
    if (!item || !requirement) throw httpError(400, `Material ${row.item || row.sku} is no longer in the production requirements`)
    const reservation = (order.materialReservations || []).find((entry) => entry.sku === row.sku)
    await warehouseStockService.recordStockOperation({
      operation: 'PRODUCTION_CONSUMPTION',
      sku: row.sku,
      quantity: Number(row.quantity || 0),
      unit: row.unit || item.baseUnit || requirement.unit,
      warehouseCode: reservation?.warehouseCode || order.warehouseCode || item.defaultWarehouseCode,
      consumeReserved: Boolean(reservation),
      date,
      reference: order.id,
      reason: `Consumed by production order ${order.id}`,
    })
    consumedBySku.set(row.sku, round(Number(consumedBySku.get(row.sku) || 0) + Number(row.quantity || 0)))
  }
  for (const reservation of order.materialReservations || []) {
    const unusedQuantity = round(Number(reservation.quantity || 0) - Number(consumedBySku.get(reservation.sku) || 0))
    if (unusedQuantity <= 0) continue
    const item = store.inventory.find((entry) => entry.sku === reservation.sku)
    if (!item) continue
    await warehouseStockService.recordStockOperation({
      operation: 'RELEASE_RESERVATION',
      sku: reservation.sku,
      quantity: unusedQuantity,
      unit: reservation.unit || item.baseUnit,
      warehouseCode: reservation.warehouseCode || order.warehouseCode || item.defaultWarehouseCode,
      reference: order.id,
      reason: `Unused reservation released from production order ${order.id}`,
    })
  }
  const finishedProduct = store.inventory.find((item) => item.sku === order.productSku)
  if (!finishedProduct) throw httpError(400, 'Finished product inventory item was not found')
  const actualOutput = (await convertItemQuantity(finishedProduct, originalActualOutput, order.productUnit)).quantity
  const quarantineOutput = Boolean(payload.quarantineOutput)
  await warehouseStockService.recordStockOperation({
    operation: quarantineOutput ? 'QUARANTINE_RECEIPT' : 'PRODUCTION_OUTPUT',
    sku: order.productSku,
    quantity: originalActualOutput,
    unit: order.productUnit,
    warehouseCode: order.warehouseCode || finishedProduct.defaultWarehouseCode,
    unitPrice: Number(order.actualCost?.unit || order.cost?.unit || finishedProduct.purchasePrice || 0),
    date,
    reference: order.id,
    batchNumber: order.id,
    reason: quarantineOutput
      ? `Failed quality output from production order ${order.id}`
      : `Finished output from production order ${order.id}`,
  })
  order.actualOutput = actualOutput
  order.originalActualOutput = originalActualOutput
  order.actualWaste = actualWaste
  order.actualWastePercent = wasteMetrics.actualWastePercent
  order.totalMaterialInputQuantity = totalMaterialInput
  order.actualWasteReason = actualWasteReason
  order.status = quarantineOutput
    ? (payload.qualityOutcome === 'REJECT' ? 'REJECTED' : 'ON_HOLD')
    : 'COMPLETED'
  order.completedAt = date
  order.updatedBy = auditActor()
  await order.save()
  await recordProductionWasteRecords(order, {
    actualWaste,
    actualWasteReason,
    reusableWaste: false,
    reusableWasteSku: '',
    reusableWasteQuantity: 0,
    reusableWasteUnit: '',
    byProducts: order.byProducts,
  }, { preserveExisting: true })
  CacheManager.clear()
  return order.toObject()
}

async function getConfiguration() { await storeModel.ensureStore(); return loadConfiguration() }

async function updateConfiguration(payload) {
  await storeModel.ensureStore()
  const existing = await ProductionConfiguration.findOne(storeModel.branchScopedQuery())
  const configuration = normalizeConfiguration(payload, existing?.toObject())
  if (existing) { Object.assign(existing, configuration); existing.updatedBy = auditActor(); await existing.save(); return existing.toObject() }
  const created = await ProductionConfiguration.create(storeModel.withBranchFields(configuration))
  return created.toObject()
}

async function loadConfiguration() {
  const configuration = await ProductionConfiguration.findOne(storeModel.branchScopedQuery()).lean()
  const masterUnits = await listUnits().catch(() => [])
  const masterUnitCodes = masterUnits.map((u) => u.code || u.name).filter(Boolean)
  const normalized = normalizeConfiguration(configuration || DEFAULT_CONFIGURATION)
  if (masterUnitCodes.length > 0) {
    normalized.units = uniqueStrings([...normalized.units, ...masterUnitCodes])
  }
  return normalized
}

async function findRecipe({ recipeId, productSku }, approvedOnly = false) {
  const query = recipeId ? { _id: recipeId } : { productSku: String(productSku || '').trim() }
  if (!recipeId && !query.productSku) throw httpError(400, 'Choose a recipe or finished product')
  const recipes = await Recipe.find(storeModel.branchScopedQuery(query)).sort({ active: -1, version: -1, createdAt: -1 }).lean()
  const recipe = recipes.map(serializeRecipe).find((row) => !approvedOnly || (row.approvalStatus === 'APPROVED' && row.active))
  if (!recipe) throw httpError(approvedOnly ? 400 : 404, approvedOnly ? 'Choose an approved active recipe before production' : 'Production recipe not found')
  return recipe
}

async function findOrder(id) {
  const identifier = String(id || '').trim()
  const identifiers = [{ id: identifier }]
  if (mongoose.Types.ObjectId.isValid(identifier)) identifiers.push({ _id: identifier })
  const order = await ProductionOrder.findOne(storeModel.branchScopedQuery({ $or: identifiers }))
  if (!order) throw httpError(404, 'Production order not found')
  return order
}

async function assertProcessAvailable(processId) {
  if (!processId) return
  const process = await ProductionProcess.findOne(storeModel.branchScopedQuery({ _id: processId, active: { $ne: false } })).lean()
  if (!process) throw httpError(400, 'Choose an active production process in the current branch')
}

async function resolveRecipeProcess(recipe) {
  if (!recipe.processId) return recipe
  const process = await ProductionProcess.findOne(storeModel.branchScopedQuery({ _id: recipe.processId, active: { $ne: false } })).lean()
  if (!process) throw httpError(400, 'The selected production process is no longer active')
  return { ...recipe, processSteps: process.steps, processName: process.name }
}

async function ensureFinishedProduct(recipe) {
  const store = await storeModel.readStore()
  const existing = store.inventory.find((item) => item.sku === recipe.productSku)
  if (existing) return
  store.inventory.unshift({ date: new Date().toISOString().slice(0, 10), item: recipe.productName, meta: `Finished product (${recipe.productUnit})`, sku: recipe.productSku, category: 'Finished Goods', itemType: 'finished_product', baseUnit: normalizeUnitCode(recipe.productUnit || 'piece'), stock: 0, capacity: Math.max(recipe.yieldQuantity, 25), price: recipe.sellingPrice, sellingPrice: recipe.sellingPrice, purchasePrice: 0, status: 'Out of Stock', serial: '', supplier: '', shelfLocation: '', leadTime: '', warranty: '' })
  await storeModel.writeStore(store)
}

async function validateRecipeUnits(recipe) {
  const materials = allRecipeMaterials(recipe)
  await Promise.all([assertUnitExists(recipe.productUnit), ...materials.map((material) => assertUnitExists(material.unit)), ...materials.flatMap((material) => (material.substitutes || []).map((substitute) => assertUnitExists(substitute.unit)))])
}

async function validateProcessUnits(process) { await Promise.all(process.steps.flatMap((step) => (step.materials || []).map((material) => assertUnitExists(material.unit)))) }

async function prepareRecipeForStorage(recipe, inventory) {
  const inventoryBySku = new Map(inventory.map((item) => [String(item.sku), item]))
  const prepareMaterials = async (materials = []) => Promise.all(materials.map(async (material) => {
    const item = inventoryBySku.get(String(material.sku))
    if (!item) return material
    const converted = await convertItemQuantity(item, material.quantity, material.unit)
    return { ...material, quantity: converted.quantity, unit: item.baseUnit || material.unit, recipeUnit: material.unit }
  }))
  return { ...recipe, materials: await prepareMaterials(recipe.materials), processSteps: await Promise.all((recipe.processSteps || []).map(async (step) => ({ ...step, materials: await prepareMaterials(step.materials) }))) }
}

async function enrichRequirementsForPurchasing(requirements, recipe, inventory) {
  const inventoryBySku = new Map(inventory.map((item) => [String(item.sku), item]))
  const materialsBySku = new Map(allRecipeMaterials(recipe).map((material) => [String(material.sku), material]))
  return Promise.all(requirements.map(async (requirement) => {
    const item = inventoryBySku.get(String(requirement.sku))
    const material = materialsBySku.get(String(requirement.sku))
    const supplier = (item?.supplierOptions || []).find((entry) => entry.supplierId === item.defaultSupplierId) || item?.supplierOptions?.[0] || {}
    const purchaseUnit = normalizeUnitCode(supplier.purchaseUnit || item?.baseUnit || requirement.unit)
    const unroundedPurchaseQuantity = requirement.shortageQuantity > 0 && item ? (await convertQuantity({ quantity: requirement.shortageQuantity, fromUnit: item.baseUnit || requirement.unit, toUnit: purchaseUnit, productSku: item.sku })).quantity : 0
    const packageSize = positiveNumber(supplier.packSize, 1) || 1
    const packagesRequired = unroundedPurchaseQuantity > 0 ? Math.ceil(unroundedPurchaseQuantity / packageSize) : 0
    const purchaseQuantity = round(packagesRequired * packageSize)
    const purchaseUnitPrice = positiveNumber(supplier.price, item?.purchasePrice ?? item?.price ?? requirement.unitCost)
    return { ...requirement, unit: item?.baseUnit || requirement.unit, recipeUnit: material?.recipeUnit || material?.unit || requirement.unit, purchaseUnit, unroundedPurchaseQuantity, packageSize, packagesRequired, purchaseQuantity, supplierId: supplier.supplierId || '', supplierName: supplier.supplierName || '', purchaseUnitPrice, purchaseCost: round(purchaseQuantity * purchaseUnitPrice) }
  }))
}

function buildInventoryAvailability(inventory = [], balances = []) {
  const bySku = new Map()
  balances.forEach((balance) => {
    const current = bySku.get(String(balance.sku)) || { onHand: 0, reserved: 0, incoming: 0, quarantined: 0 }
    current.onHand += Number(balance.onHand || 0); current.reserved += Number(balance.reserved || 0); current.incoming += Number(balance.incoming || 0); current.quarantined += Number(balance.quarantined || 0)
    bySku.set(String(balance.sku), current)
  })
  return inventory.map((item) => {
    const balance = bySku.get(String(item.sku)) || { onHand: Number(item.stock || 0), reserved: 0, incoming: 0, quarantined: 0 }
    const onHand = round(balance.onHand); const reserved = round(balance.reserved)
    return { ...item, onHand, reserved, incoming: round(balance.incoming), quarantined: round(balance.quarantined), available: round(Math.max(0, onHand - reserved)) }
  })
}

function serializeInventory(item) {
  return { sku: item.sku, item: item.item, category: item.category, itemType: item.itemType || 'raw_material', stock: Number(item.stock || 0), price: Number(item.price || 0), purchasePrice: Number(item.purchasePrice ?? item.price ?? 0), baseUnit: item.baseUnit || 'piece', onHand: Number(item.onHand ?? item.stock ?? 0), reserved: Number(item.reserved || 0), incoming: Number(item.incoming || 0), available: Number(item.available ?? item.stock ?? 0), supplierOptions: item.supplierOptions || [] }
}

function calculateScheduleWarnings({ configuration, orders, recipe, scheduledDate }) {
  const warnings = []
  const assignedMachines = new Set([...(recipe.machines || []), ...(recipe.processSteps || []).flatMap((step) => step.machines || [])].map((row) => row.name))
  const assignedWorkers = new Set([...(recipe.labor || []), ...(recipe.processSteps || []).flatMap((step) => step.labor || [])].map((row) => row.name))
  configuration.machines.filter((machine) => assignedMachines.has(machine.name) && String(machine.status).toLowerCase() !== 'available').forEach((machine) => warnings.push(`${machine.name} is marked ${machine.status}.`))
  orders.filter((order) => order.scheduledDate === scheduledDate && order.productSku === recipe.productSku).forEach((order) => warnings.push(`${order.id} is already scheduled for this product on ${scheduledDate}.`))
  if (assignedWorkers.size === 0 && assignedMachines.size === 0) warnings.push('No labor or equipment assignments are configured for scheduling.')
  return [...new Set(warnings)]
}

async function assertOrderTransition(order, nextStatus) {
  if (nextStatus === 'CANCELLED') return
  if (nextStatus === 'PENDING_APPROVAL' && order.status === 'DRAFT') return
  if (nextStatus === 'IN_PROGRESS' && ['APPROVED', 'PLANNED', 'MATERIALS_READY', 'PAUSED', 'REWORK', 'ON_HOLD'].includes(order.status) && order.approvedAt) {
    await assertOrderCanStart(order)
    return
  }
  if (nextStatus === 'PAUSED' && order.status === 'IN_PROGRESS') return
  if (nextStatus === 'QUALITY_CHECK' && order.status === 'IN_PROGRESS') return
  throw httpError(400, 'Use the approval action before starting production, and quality inspection to complete it')
}

async function assertOrderCanStart(order) {
  if (order.materialReservations?.length) return
  const store = await storeModel.readStore()
  for (const requirement of order.requirements) {
    const item = store.inventory.find((entry) => entry.sku === requirement.sku)
    if (!item) throw httpError(400, `Material ${requirement.item} is no longer in inventory`)
    await warehouseStockService.assertWarehouseAvailable({
      item,
      quantity: Number(requirement.requiredQuantity || 0),
      warehouseCode: order.warehouseCode || item.defaultWarehouseCode,
    })
  }
}

function buildRecipe(payload, fallback = {}) {
  const productName = String(payload.productName || fallback.productName || '').trim()
  const productSku = String(payload.productSku || fallback.productSku || `FG-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`).trim().toUpperCase()
  const yieldQuantity = positiveNumber(payload.yieldQuantity ?? fallback.yieldQuantity, 0)
  if (!productName || yieldQuantity <= 0) throw httpError(400, 'Product name and yield quantity are required')
  const materials = normalizeMaterials(payload.materials ?? fallback.materials)
  if (materials.length === 0) throw httpError(400, 'Add at least one material or packaging requirement to the recipe')
  return { productName, productSku, productUnit: String(payload.productUnit || fallback.productUnit || 'piece').trim() || 'piece', servingSize: positiveNumber(payload.servingSize ?? fallback.servingSize, 0), servingUnit: String(payload.servingUnit ?? fallback.servingUnit ?? '').trim(), versionLabel: String(payload.versionLabel ?? fallback.versionLabel ?? '').trim(), sellingPrice: positiveNumber(payload.sellingPrice ?? fallback.sellingPrice, 0), yieldQuantity, expectedWastePercent: normalizePercent(payload.expectedWastePercent ?? fallback.expectedWastePercent, 'Expected recipe waste'), materials, labor: normalizeTimedAssignments(payload.labor ?? fallback.labor), machines: normalizeTimedAssignments(payload.machines ?? fallback.machines), utilities: normalizeUtilityAssignments(payload.utilities ?? fallback.utilities), processSteps: normalizeProcessSteps(payload.processSteps ?? fallback.processSteps), processId: String(payload.processId ?? fallback.processId ?? '').trim(), notes: String((payload.notes ?? fallback.notes) || '').trim() }
}

function buildProcess(payload, fallback = {}) {
  const name = String(payload.name ?? fallback.name ?? '').trim()
  const code = String(payload.code ?? fallback.code ?? name).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_')
  const steps = normalizeProcessSteps(payload.steps ?? fallback.steps)
  if (!name || !code || steps.length === 0) throw httpError(400, 'Process name, code, and at least one production step are required')
  return { name, code, description: String(payload.description ?? fallback.description ?? '').trim(), steps, active: payload.active === undefined ? fallback.active !== false : Boolean(payload.active) }
}

function normalizeMaterials(materials = []) {
  return (materials || []).map((material) => ({ sku: String(material.sku || '').trim(), item: String(material.item || '').trim(), quantity: positiveNumber(material.quantity, 0), unit: String(material.unit || 'unit').trim() || 'unit', materialType: String(material.materialType || 'material') === 'packaging' ? 'packaging' : 'material', wastePercent: normalizePercent(material.wastePercent, `Waste allowance for ${String(material.item || material.sku || 'material')}`), substitutes: (material.substitutes || []).map((substitute) => ({ sku: String(substitute.sku || '').trim(), item: String(substitute.item || '').trim(), quantity: positiveNumber(substitute.quantity, 0), unit: String(substitute.unit || material.unit || 'unit').trim() })).filter((substitute) => substitute.sku && substitute.item && substitute.quantity > 0) })).filter((material) => material.sku && material.item && material.quantity > 0)
}

function normalizeConfiguration(payload = {}, fallback = DEFAULT_CONFIGURATION) {
  return {
    units: uniqueStrings(payload.units ?? fallback.units ?? DEFAULT_CONFIGURATION.units),
    conversions: (payload.conversions ?? fallback.conversions ?? []).map((conversion) => ({ fromUnit: String(conversion.fromUnit || '').trim(), toUnit: String(conversion.toUnit || '').trim(), factor: positiveNumber(conversion.factor, 0) })).filter((conversion) => conversion.fromUnit && conversion.toUnit && conversion.factor > 0),
    workers: (payload.workers ?? fallback.workers ?? []).map((worker) => ({
      code: String(worker.code || '').trim(), name: String(worker.name || '').trim(), role: String(worker.role || '').trim(), skills: uniqueStrings(Array.isArray(worker.skills) ? worker.skills : String(worker.skills || '').split(',')),
      rateType: normalizeWorkerRateType(worker.rateType), rate: positiveNumber(worker.rate ?? worker.hourlyRate, 0), hourlyRate: positiveNumber(worker.hourlyRate ?? worker.rate, 0), overtimeRate: positiveNumber(worker.overtimeRate, 0),
      availableHoursPerDay: positiveNumber(worker.availableHoursPerDay, 8), active: worker.active !== false,
    })).filter((worker) => worker.name),
    machines: (payload.machines ?? fallback.machines ?? []).map((machine) => ({
      code: String(machine.code || '').trim(), name: String(machine.name || '').trim(), machineType: String(machine.machineType || '').trim(), purchasePrice: positiveNumber(machine.purchasePrice, 0),
      purchaseDate: normalizeDate(machine.purchaseDate), usefulLifeYears: positiveNumber(machine.usefulLifeYears, 0), residualValue: positiveNumber(machine.residualValue, 0), capacityUnit: String(machine.capacityUnit || 'unit').trim() || 'unit',
      hourlyRate: positiveNumber(machine.hourlyRate ?? machine.rate, 0), rate: positiveNumber(machine.rate ?? machine.hourlyRate, 0), costingMethod: normalizeMachineCostingMethod(machine.costingMethod), capacityPerHour: positiveNumber(machine.capacityPerHour, 0),
      electricityPerHour: positiveNumber(machine.electricityPerHour, 0), fuelPerHour: positiveNumber(machine.fuelPerHour, 0), status: normalizeMachineStatus(machine.status), operatingHours: positiveNumber(machine.operatingHours, 0),
      maintenanceIntervalHours: positiveNumber(machine.maintenanceIntervalHours, 0), lastMaintenanceHours: positiveNumber(machine.lastMaintenanceHours, 0),
    })).filter((machine) => machine.name),
    utilities: (payload.utilities ?? fallback.utilities ?? []).map((utility) => ({ name: String(utility.name || '').trim(), unit: String(utility.unit || 'unit').trim() || 'unit', rate: positiveNumber(utility.rate, 0) })).filter((utility) => utility.name),
    overheadCosts: (payload.overheadCosts ?? fallback.overheadCosts ?? []).map((entry) => ({ name: String(entry.name || '').trim(), amount: positiveNumber(entry.amount, 0), allocationMethod: normalizeAllocationMethod(entry.allocationMethod), active: entry.active !== false })).filter((entry) => entry.name),
    overheadRatePerUnit: positiveNumber(payload.overheadRatePerUnit ?? fallback.overheadRatePerUnit, 0),
    transportCostPerBatch: positiveNumber(payload.transportCostPerBatch ?? fallback.transportCostPerBatch, 0),
    separationOfDuties: Boolean(payload.separationOfDuties ?? fallback.separationOfDuties),
  }
}

function normalizeTimedAssignments(assignments = []) { return (assignments || []).map((assignment) => ({ name: String(assignment.name || '').trim(), hoursPerBatch: positiveNumber(assignment.hoursPerBatch, 0) })).filter((assignment) => assignment.name && assignment.hoursPerBatch > 0) }
function normalizeUtilityAssignments(assignments = []) { return (assignments || []).map((assignment) => ({ name: String(assignment.name || '').trim(), quantityPerBatch: positiveNumber(assignment.quantityPerBatch, 0) })).filter((assignment) => assignment.name && assignment.quantityPerBatch > 0) }
function normalizeActualLabor(rows = [], workers = [], outputQuantity, batches) {
  return (rows || []).map((row) => {
    const name = String(row.name || '').trim()
    const worker = findConfiguredResource(workers, name)
    const hours = positiveNumber(row.hours, 0)
    const overtimeHours = positiveNumber(row.overtimeHours, 0)
    const rate = positiveNumber(row.rate, positiveNumber(worker?.rate ?? worker?.hourlyRate, 0))
    const cost = round(resourceCost(worker, rate, hours, overtimeHours, outputQuantity, batches, 'labor'))
    return { name, hours, rate, overtimeHours, cost }
  }).filter((row) => row.name && (row.hours > 0 || row.overtimeHours > 0))
}
function normalizeActualMachines(rows = [], machines = [], outputQuantity, batches) {
  return (rows || []).map((row) => {
    const name = String(row.name || '').trim()
    const machine = findConfiguredResource(machines, name)
    const hours = positiveNumber(row.hours, 0)
    const quantity = positiveNumber(row.quantity, outputQuantity)
    const rate = positiveNumber(row.rate, positiveNumber(machine?.rate ?? machine?.hourlyRate, 0))
    const cost = round(resourceCost(machine, rate, hours, 0, quantity, batches, 'machine'))
    return { name, hours, quantity, rate, cost }
  }).filter((row) => row.name && (row.hours > 0 || row.quantity > 0))
}
function normalizeActualUtilities(rows = [], utilities = []) {
  return (rows || []).map((row) => {
    const name = String(row.name || '').trim()
    const utility = findConfiguredResource(utilities, name)
    const quantity = positiveNumber(row.quantity, 0)
    const rate = positiveNumber(row.rate, positiveNumber(utility?.rate, 0))
    return { name, quantity, unit: String(row.unit || utility?.unit || 'unit').trim() || 'unit', rate, cost: round(quantity * rate) }
  }).filter((row) => row.name && row.quantity > 0)
}
function normalizeByProducts(rows = []) { return (rows || []).map((row) => ({ sku: String(row.sku || '').trim(), item: String(row.item || '').trim(), quantity: positiveNumber(row.quantity, 0), unit: String(row.unit || 'piece').trim() || 'piece', notes: String(row.notes || '').trim() })).filter((row) => row.sku && row.item && row.quantity > 0) }
function resourceCost(resource = {}, rate, hours, overtimeHours, quantity, batches, type) {
  const method = String(type === 'machine' ? resource.costingMethod : resource.rateType || 'hourly').toLowerCase()
  if (type === 'machine' && method === 'depreciation') {
    const depreciable = Math.max(0, positiveNumber(resource.purchasePrice, 0) - positiveNumber(resource.residualValue, 0))
    return hours * depreciable / Math.max(1, positiveNumber(resource.usefulLifeYears, 0) * 12 * 176)
  }
  if (method === 'monthly') return hours * rate / 176 + overtimeHours * positiveNumber(resource.overtimeRate, rate)
  if (method === 'daily') return hours * rate / Math.max(1, positiveNumber(resource.availableHoursPerDay, 8)) + overtimeHours * positiveNumber(resource.overtimeRate, rate)
  if (method === 'per_product' || method === 'quantity') return quantity * rate
  if (method === 'per_batch' || method === 'batch') return batches * rate
  return (hours + overtimeHours) * rate
}
function findConfiguredResource(resources = [], name) { return (resources || []).find((resource) => String(resource.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase()) }
function calculateCostVariance(actual = {}, estimated = {}) {
  const keys = ['material', 'packaging', 'labor', 'machine', 'utility', 'overhead', 'transport', 'waste', 'rework', 'total', 'unit']
  return keys.reduce((variance, key) => ({ ...variance, [key]: round(positiveNumber(actual[key], 0) - positiveNumber(estimated[key], 0)) }), {})
}
async function updateMachineOperatingHours(actualMachines = []) {
  if (!actualMachines.length) return
  const configuration = await ProductionConfiguration.findOne(storeModel.branchScopedQuery())
  if (!configuration) return
  const hoursByName = new Map(actualMachines.map((row) => [String(row.name).toLowerCase(), Number(row.hours || 0)]))
  configuration.machines.forEach((machine) => {
    const hours = hoursByName.get(String(machine.name || '').toLowerCase())
    if (hours) machine.operatingHours = round(Number(machine.operatingHours || 0) + hours)
  })
  configuration.updatedBy = auditActor()
  await configuration.save()
}
function normalizeProcessSteps(steps = []) {
  return (steps || []).map((step, index) => ({ sequence: Math.max(1, Math.floor(positiveNumber(step.sequence, index + 1))), name: String(step.name || '').trim(), description: String(step.description || '').trim(), durationHours: positiveNumber(step.durationHours, 0), capacityPerHour: positiveNumber(step.capacityPerHour, 0), instructions: String(step.instructions || '').trim(), qualityCheck: String(step.qualityCheck || '').trim(), materials: normalizeMaterials(step.materials), labor: normalizeTimedAssignments(step.labor), machines: normalizeTimedAssignments(step.machines), utilities: normalizeUtilityAssignments(step.utilities), expectedOutputQuantity: positiveNumber(step.expectedOutputQuantity, 0), expectedWastePercent: normalizePercent(step.expectedWastePercent, `Expected waste for step ${String(step.name || index + 1)}`), optional: Boolean(step.optional), reworkAllowed: Boolean(step.reworkAllowed) })).filter((step) => step.name).sort((left, right) => left.sequence - right.sequence).map((step, index) => ({ ...step, sequence: index + 1 }))
}

function normalizePercent(value, label) {
  const percentage = positiveNumber(value, 0)
  if (percentage > 100) throw httpError(400, `${label} must be between 0 and 100 percent`)
  return percentage
}

function allRecipeMaterials(recipe) { return [...(recipe.materials || []), ...(recipe.processSteps || []).flatMap((step) => step.materials || [])] }
function serializeRecipe(recipe) { const approvalStatus = effectiveApprovalStatus(recipe); return { ...recipe, version: Number(recipe.version || 1), versionLabel: recipe.versionLabel || `v${Number(recipe.version || 1)}`, approvalStatus, active: approvalStatus === 'APPROVED' && recipe.active !== false } }
function effectiveApprovalStatus(recipe) { return String(recipe.approvalStatus || 'APPROVED').toUpperCase() }
async function nextRecipeVersion(productSku) { const latest = await Recipe.findOne(storeModel.branchScopedQuery({ productSku })).sort({ version: -1 }).lean(); return Number(latest?.version || 0) + 1 }
async function ensureRecipeIndexes() {
  if (!recipeIndexMigration) {
    recipeIndexMigration = (async () => {
      await Recipe.updateMany({ version: { $exists: false } }, { $set: { version: 1, approvalStatus: 'APPROVED' } })
      try { await Recipe.collection.dropIndex('ownerKey_1_branchCode_1_productSku_1') } catch (error) { if (error.code !== 27 && error.codeName !== 'IndexNotFound') throw error }
      await Recipe.collection.createIndex({ ownerKey: 1, branchCode: 1, productSku: 1, version: 1 }, { unique: true })
    })()
  }
  await recipeIndexMigration
}
function normalizeDate(value) { const date = String(value || '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '' }
function addHoursToDate(date, hours) { const parsed = new Date(`${date}T00:00:00.000Z`); if (Number.isNaN(parsed.getTime())) return ''; parsed.setUTCHours(parsed.getUTCHours() + Math.ceil(Number(hours || 0))); return parsed.toISOString().slice(0, 10) }
function uniqueStrings(values) { return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))] }
function positiveNumber(value, fallback) { const numeric = Number(value); return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback }
function normalizeWorkerRateType(value) { return ['monthly', 'daily', 'hourly', 'per_product', 'per_batch'].includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'hourly' }
function normalizeMachineCostingMethod(value) { return ['hourly', 'quantity', 'batch', 'depreciation'].includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'hourly' }
function normalizeMachineStatus(value) { const wanted = String(value || 'Available').trim().toLowerCase(); return ({ available: 'Available', 'in use': 'In Use', maintenance: 'Maintenance', broken: 'Broken', retired: 'Retired' })[wanted] || 'Available' }
function normalizeAllocationMethod(value) { return ['per_unit', 'per_batch', 'per_production_hour', 'percentage', 'fixed'].includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'per_unit' }
function round(value) { return Number(Number(value || 0).toFixed(4)) }
function inventoryStatus(stock, capacity) { if (stock <= 0) return 'Out of Stock'; if (stock <= Number(capacity || 0) * 0.2) return 'Low'; return 'Active' }

module.exports = { applyQualityResult, approveProductionOrder, approveRecipe, approveWasteRecord, calculatePlan, createProcess, createProductionOrder, createPurchaseRequest, createRecipe, getConfiguration, getOverview, listOrders, listProcesses, listPurchaseRequests, listRecipes, listWasteRecords, recordProductionExecution, recordQualityInspection, reserveProductionOrderMaterials, updateConfiguration, updateProcess, updateProductionOrder, updatePurchaseRequest, updateRecipe }

const Inventory = require('../models/Inventory')
const mongoose = require('mongoose')
const ProductionOrder = require('../models/ProductionOrder')
const ProductionProcess = require('../models/ProductionProcess')
const QualityInspection = require('../models/QualityInspection')
const QualityStandard = require('../models/QualityStandard')
const storeModel = require('../models/storeModel')
const httpError = require('../utils/httpError')
const { auditActor, currentTenant } = require('../utils/tenantContext')
const { evaluateQualityResults, normalizeQualityCriteria } = require('../utils/qualityEvaluation')

async function getOverview() {
  await storeModel.ensureStore()
  const [standards, inspections, products, processes, orders] = await Promise.all([
    QualityStandard.find(storeModel.branchScopedQuery()).sort({ name: 1 }).lean(),
    QualityInspection.find(storeModel.branchScopedQuery()).sort({ inspectionDate: -1, createdAt: -1 }).limit(100).lean(),
    Inventory.find(storeModel.branchScopedQuery({ status: { $ne: 'Deleted' } })).select('sku item baseUnit itemType').sort({ item: 1 }).lean(),
    ProductionProcess.find(storeModel.branchScopedQuery({ active: { $ne: false } })).select('code name steps').sort({ name: 1 }).lean(),
    ProductionOrder.find(storeModel.branchScopedQuery()).select('id productSku productName status').sort({ createdAt: -1 }).limit(300).lean(),
  ])
  return { standards, inspections, products, processes, orders }
}

async function createStandard(payload = {}) {
  await storeModel.ensureStore()
  const standard = normalizeStandard(payload)
  await validateStandardLinks(standard)
  const created = await QualityStandard.create(storeModel.withBranchFields(standard))
  return created.toObject()
}

async function updateStandard(id, payload = {}) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw httpError(404, 'Quality standard not found')
  const standard = await QualityStandard.findOne(storeModel.branchScopedQuery({ _id: id }))
  if (!standard) throw httpError(404, 'Quality standard not found')
  const next = normalizeStandard({ ...standard.toObject(), ...payload })
  await validateStandardLinks(next)
  Object.assign(standard, next, { updatedBy: auditActor() })
  await standard.save()
  return standard.toObject()
}

async function createInspection(payload = {}) {
  await storeModel.ensureStore()
  const productSku = normalizeCode(payload.productSku)
  const batchNumber = String(payload.batchNumber || payload.productionOrderId || '').trim()
  if (!productSku || !batchNumber) throw httpError(400, 'Product and batch number are required')
  if (!mongoose.Types.ObjectId.isValid(payload.standardId)) throw httpError(404, 'Active quality standard not found')
  const productionOrderId = String(payload.productionOrderId || '').trim()
  const [product, standard, order] = await Promise.all([
    Inventory.findOne(storeModel.branchScopedQuery({ sku: productSku })).lean(),
    QualityStandard.findOne(storeModel.branchScopedQuery({ _id: payload.standardId, active: true })).lean(),
    productionOrderId ? ProductionOrder.findOne(storeModel.branchScopedQuery({ id: productionOrderId })) : null,
  ])
  if (!product) throw httpError(404, 'Product not found in the current branch')
  if (!standard) throw httpError(404, 'Active quality standard not found')
  if (standard.productSku && standard.productSku !== productSku) throw httpError(400, 'Quality standard does not apply to this product')
  if (productionOrderId && !order) throw httpError(404, 'Production order not found in the current branch')
  if (order && order.productSku !== productSku) throw httpError(400, 'Inspection product does not match the production order')
  if (order && !['IN_PROGRESS', 'QUALITY_CHECK', 'ON_HOLD', 'REWORK'].includes(order.status)) {
    throw httpError(400, 'Production order is not awaiting a quality inspection')
  }
  if (order?.completedAt) throw httpError(400, 'This production run has already been completed or quarantined')

  const processCode = normalizeCode(payload.processCode)
  const stepSequence = payload.stepSequence ? positiveInteger(payload.stepSequence, 'Process step') : null
  if (standard.processCode && standard.processCode !== processCode) throw httpError(400, 'Quality standard does not apply to this process')
  if (standard.stepSequence && standard.stepSequence !== stepSequence) throw httpError(400, 'Quality standard does not apply to this process step')

  const evaluated = evaluateQualityResults(standard.criteria, payload.results)
  const inspectionDate = parseDate(payload.inspectionDate)
  const actor = auditActor()
  const inspection = await QualityInspection.create(storeModel.withBranchFields({
    standardId: standard._id,
    inspectionDate,
    inspector: actor,
    productSku,
    productName: product.item,
    productionOrderId,
    batchNumber,
    processCode,
    stepSequence,
    results: evaluated.results,
    outcome: evaluated.passed ? 'PASS' : 'FAIL',
    notes: String(payload.notes || '').trim(),
  }))
  if (order) {
    try {
      const productionService = require('./productionService')
      await productionService.applyQualityResult(order.id, inspection.outcome, {
        actualOutput: Number(payload.actualOutput || order.originalActualOutput || order.plannedQuantity),
        date: inspection.inspectionDate.toISOString().slice(0, 10),
        notes: inspection.notes,
        quarantineFailedOutput: payload.quarantineFailedOutput !== false,
      })
    } catch (error) {
      inspection.outcome = 'ON_HOLD'
      inspection.notes = [inspection.notes, 'Production quality disposition requires review after a processing error.'].filter(Boolean).join(' ')
      await inspection.save()
      throw error
    }
  }
  return inspection.toObject()
}

async function setDisposition(id, payload = {}) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw httpError(404, 'Quality inspection not found')
  const outcome = String(payload.outcome || '').trim().toUpperCase()
  if (!['ON_HOLD', 'REWORK', 'REJECT'].includes(outcome)) {
    throw httpError(400, 'Disposition must be ON_HOLD, REWORK, or REJECT')
  }
  const inspection = await QualityInspection.findOne(storeModel.branchScopedQuery({ _id: id }))
  if (!inspection) throw httpError(404, 'Quality inspection not found')
  if (!['FAIL', 'ON_HOLD', 'REWORK'].includes(inspection.outcome)) {
    throw httpError(400, 'Only failed or unresolved inspections can be dispositioned')
  }
  inspection.outcome = outcome
  inspection.notes = payload.notes === undefined ? inspection.notes : String(payload.notes).trim()
  if (inspection.productionOrderId) {
    await syncProductionOrderDisposition(inspection)
  }
  inspection.dispositionApprovedBy = auditActor()
  inspection.dispositionApprovedAt = new Date()
  inspection.updatedBy = auditActor()
  await inspection.save()
  return inspection.toObject()
}

async function syncProductionOrderDisposition(inspection) {
  const order = await ProductionOrder.findOne(storeModel.branchScopedQuery({ id: inspection.productionOrderId }))
  if (!order) throw httpError(409, 'Linked production order was not found; inspection disposition was saved but production could not be updated')
  order.status = inspection.outcome === 'REWORK'
    ? 'REWORK'
    : inspection.outcome === 'REJECT'
      ? 'REJECTED'
      : 'ON_HOLD'
  order.updatedBy = auditActor()
  await order.save()
}

async function validateStandardLinks(standard) {
  const tenant = currentTenant()
  if (!tenant.ownerKey) throw httpError(403, 'Select a business before managing quality standards')
  if (!standard.productSku && !standard.processCode) throw httpError(400, 'A standard must be linked to a product or process')
  if (standard.productSku && !await Inventory.exists(storeModel.branchScopedQuery({ sku: standard.productSku }))) {
    throw httpError(404, 'Product not found in the current branch')
  }
  if (standard.processCode) {
    const process = await ProductionProcess.findOne(storeModel.branchScopedQuery({ code: standard.processCode, active: { $ne: false } })).lean()
    if (!process) throw httpError(404, 'Active production process not found')
    if (standard.stepSequence && !process.steps.some((step) => Number(step.sequence) === standard.stepSequence)) {
      throw httpError(400, 'Process step does not exist')
    }
  }
}

function normalizeStandard(payload = {}) {
  const name = String(payload.name || '').trim()
  const productSku = normalizeCode(payload.productSku)
  const processCode = normalizeCode(payload.processCode)
  const stepSequence = payload.stepSequence ? positiveInteger(payload.stepSequence, 'Process step') : null
  if (!name) throw httpError(400, 'Quality standard name is required')
  if (stepSequence && !processCode) throw httpError(400, 'A process code is required when setting a process step')
  return {
    name,
    productSku,
    processCode,
    stepSequence,
    criteria: normalizeQualityCriteria(payload.criteria),
    active: payload.active === undefined ? true : Boolean(payload.active),
  }
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase()
}

function positiveInteger(value, label) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1) throw httpError(400, `${label} must be a positive whole number`)
  return number
}

function parseDate(value) {
  const date = value ? new Date(value) : new Date()
  if (!Number.isFinite(date.getTime())) throw httpError(400, 'Inspection date must be a valid date')
  return date
}

module.exports = { createInspection, createStandard, getOverview, setDisposition, updateStandard }

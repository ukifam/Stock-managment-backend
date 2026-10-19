const Pipeline = require('../models/Pipeline')
const storeModel = require('../models/storeModel')
const { auditActor, withBranchFields, branchScopedQuery } = require('../utils/tenantContext')

async function listPipelines() {
  await storeModel.ensureStore()
  return Pipeline.find(branchScopedQuery()).sort({ updatedAt: -1, createdAt: -1 }).lean()
}

async function upsertPipeline(payload = {}) {
  await storeModel.ensureStore()
  if (!payload.id) throw Object.assign(new Error('Pipeline id is required'), { status: 400 })

  const actor = auditActor()
  const data = {
    id: payload.id,
    productName: String(payload.productName || '').trim(),
    businessType: String(payload.businessType || '').trim(),
    singleUnitLabel: String(payload.singleUnitLabel || 'unit').trim(),
    ingredients: Array.isArray(payload.ingredients) ? payload.ingredients : [],
    targetQuantity: Number(payload.targetQuantity) || 1,
    scheduledDate: String(payload.scheduledDate || '').trim(),
    currentStage: String(payload.currentStage || 'plan').trim(),
    completedStages: Array.isArray(payload.completedStages) ? payload.completedStages : [],
    executionMode: String(payload.executionMode || 'delegated').trim(),
    activityLog: Array.isArray(payload.activityLog) ? payload.activityLog : [],
    totalIngredients: Array.isArray(payload.totalIngredients) ? payload.totalIngredients : [],
    totalMaterialCost: Number(payload.totalMaterialCost) || 0,
    purchasedItems: Array.isArray(payload.purchasedItems) ? payload.purchasedItems : [],
    producedQuantity: Number(payload.producedQuantity) || 0,
    productionStartTime: String(payload.productionStartTime || '').trim(),
    productionEndTime: String(payload.productionEndTime || '').trim(),
    productionNotes: String(payload.productionNotes || '').trim(),
    qualityResult: payload.qualityResult || null,
    sellingPricePerUnit: Number(payload.sellingPricePerUnit) || 0,
    sales: Array.isArray(payload.sales) ? payload.sales : [],
    rawMaterialsStored: Boolean(payload.rawMaterialsStored),
    finishedGoodsStored: Boolean(payload.finishedGoodsStored),
    finishedGoodsLocation: String(payload.finishedGoodsLocation || '').trim(),
    createdAt: String(payload.createdAt || new Date().toISOString()),
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  }

  const existing = await Pipeline.findOne(branchScopedQuery({ id: payload.id }))
  if (existing) {
    Object.assign(existing, data)
    await existing.save()
    return existing.toObject()
  } else {
    const created = await Pipeline.create(withBranchFields({ ...data, createdBy: actor }))
    return created.toObject()
  }
}

async function bulkUpsertPipelines(pipelines = []) {
  if (!Array.isArray(pipelines) || pipelines.length === 0) return []
  return Promise.all(pipelines.map((p) => upsertPipeline(p).catch(() => null)))
}

async function deletePipeline(id) {
  await storeModel.ensureStore()
  const result = await Pipeline.deleteOne(branchScopedQuery({ id }))
  if (result.deletedCount === 0) throw Object.assign(new Error('Pipeline not found'), { status: 404 })
  return { deleted: true, id }
}

module.exports = { listPipelines, upsertPipeline, bulkUpsertPipelines, deletePipeline }

const Pipeline = require('../models/Pipeline')
const storeModel = require('../models/storeModel')
const { auditActor, withBranchFields, branchScopedQuery } = require('../utils/tenantContext')
const { normalizeStage, planFields, serializePipeline } = require('./pipelineWorkflowService')

async function listPipelines() {
  await storeModel.ensureStore()
  const rows = await Pipeline.find(branchScopedQuery()).sort({ updatedAt: -1, createdAt: -1 }).lean()
  return rows.map(serializePipeline)
}

// Clients may only edit the order (plan) before it is submitted; every later step
// goes through the workflow endpoints so stock and money stay consistent.
async function upsertPipeline(payload = {}) {
  await storeModel.ensureStore()
  if (!payload.id) throw Object.assign(new Error('Pipeline id is required'), { status: 400 })

  const actor = auditActor()
  const executionMode = payload.executionMode === 'solo' ? 'solo' : 'delegated'
  const existing = await Pipeline.findOne(branchScopedQuery({ id: payload.id }))

  if (existing) {
    existing.executionMode = executionMode
    if (normalizeStage(existing.currentStage) === 'plan') Object.assign(existing, planFields(payload))
    existing.updatedAt = new Date().toISOString()
    existing.updatedBy = actor
    await existing.save()
    return serializePipeline(existing)
  }

  const created = await Pipeline.create(withBranchFields({
    id: payload.id,
    ...planFields(payload),
    executionMode,
    currentStage: 'plan',
    completedStages: [],
    createdAt: String(payload.createdAt || new Date().toISOString()),
    updatedAt: new Date().toISOString(),
    createdBy: actor,
    updatedBy: actor,
  }))
  return serializePipeline(created)
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

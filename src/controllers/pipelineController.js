const pipelineService = require('../services/pipelineService')

async function listPipelines(req, res, next) {
  try {
    const pipelines = await pipelineService.listPipelines()
    res.json({ pipelines })
  } catch (err) {
    next(err)
  }
}

async function upsertPipeline(req, res, next) {
  try {
    const pipeline = await pipelineService.upsertPipeline(req.body)
    res.json({ pipeline })
  } catch (err) {
    next(err)
  }
}

async function bulkUpsertPipelines(req, res, next) {
  try {
    const { pipelines } = req.body
    if (!Array.isArray(pipelines)) {
      return res.status(400).json({ error: 'pipelines must be an array' })
    }
    const results = await pipelineService.bulkUpsertPipelines(pipelines)
    res.json({ pipelines: results.filter(Boolean) })
  } catch (err) {
    next(err)
  }
}

async function deletePipeline(req, res, next) {
  try {
    const result = await pipelineService.deletePipeline(req.params.id)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

module.exports = { listPipelines, upsertPipeline, bulkUpsertPipelines, deletePipeline }

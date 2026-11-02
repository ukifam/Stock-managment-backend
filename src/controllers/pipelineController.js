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

const workflow = require('../services/pipelineWorkflowService')

const STEPS = {
  submit: (req) => workflow.submitOrder(req.params.id, req.body, req.user),
  'check-stock': (req) => workflow.checkStock(req.params.id, req.user),
  recheck: (req) => workflow.recheckStock(req.params.id, req.user),
  'purchase-order': (req) => workflow.createPurchaseOrder(req.params.id, req.body, req.user),
  pay: (req) => workflow.payPurchaseOrder(req.params.id, req.body, req.user),
  receive: (req) => workflow.receiveGoods(req.params.id, req.body, req.user),
  make: (req) => workflow.makeProducts(req.params.id, req.body, req.user),
  quality: (req) => workflow.checkQuality(req.params.id, req.body, req.user),
  store: (req) => workflow.storeProducts(req.params.id, req.body, req.user),
}

function runStep(name) {
  return async (req, res, next) => {
    try {
      res.json({ pipeline: await STEPS[name](req) })
    } catch (err) {
      next(err)
    }
  }
}

async function getStockCheck(req, res, next) {
  try {
    res.json(await workflow.getStockCheck(req.params.id))
  } catch (err) {
    next(err)
  }
}

module.exports = { listPipelines, upsertPipeline, bulkUpsertPipelines, deletePipeline, runStep, getStockCheck }

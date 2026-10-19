const productionService = require('../services/productionService')
const operationsPlanningService = require('../services/operationsPlanningService')

async function getOverview(_req, res, next) {
  try {
    res.json(await productionService.getOverview())
  } catch (error) {
    next(error)
  }
}

async function listRecipes(_req, res, next) {
  try {
    res.json(await productionService.listRecipes())
  } catch (error) {
    next(error)
  }
}

async function createRecipe(req, res, next) {
  try {
    res.status(201).json(await productionService.createRecipe(req.body))
  } catch (error) {
    next(error)
  }
}

async function updateRecipe(req, res, next) {
  try {
    res.json(await productionService.updateRecipe(req.params.id, req.body))
  } catch (error) {
    next(error)
  }
}

async function approveRecipe(req, res, next) {
  try {
    res.json(await productionService.approveRecipe(req.params.id))
  } catch (error) {
    next(error)
  }
}

async function calculatePlan(req, res, next) {
  try {
    res.json(await productionService.calculatePlan(req.query))
  } catch (error) {
    next(error)
  }
}

async function listOrders(_req, res, next) {
  try {
    res.json(await productionService.listOrders())
  } catch (error) {
    next(error)
  }
}

async function listWasteRecords(_req, res, next) {
  try {
    res.json(await productionService.listWasteRecords())
  } catch (error) {
    next(error)
  }
}

async function approveWasteRecord(req, res, next) {
  try {
    res.json(await productionService.approveWasteRecord(req.params.id, req.body))
  } catch (error) {
    next(error)
  }
}

async function createProductionOrder(req, res, next) {
  try {
    res.status(201).json(await productionService.createProductionOrder(req.body))
  } catch (error) {
    next(error)
  }
}

async function updateProductionOrder(req, res, next) {
  try {
    res.json(await productionService.updateProductionOrder(req.params.id, req.body))
  } catch (error) {
    next(error)
  }
}

async function approveProductionOrder(req, res, next) {
  try {
    res.json(await productionService.approveProductionOrder(req.params.id))
  } catch (error) {
    next(error)
  }
}

async function reserveProductionOrderMaterials(req, res, next) {
  try {
    res.json(await productionService.reserveProductionOrderMaterials(req.params.id, req.body))
  } catch (error) {
    next(error)
  }
}

async function recordProductionExecution(req, res, next) {
  try {
    res.json(await productionService.recordProductionExecution(req.params.id, req.body))
  } catch (error) {
    next(error)
  }
}

async function listProcesses(_req, res, next) {
  try {
    res.json(await productionService.listProcesses())
  } catch (error) {
    next(error)
  }
}

async function createProcess(req, res, next) {
  try {
    res.status(201).json(await productionService.createProcess(req.body))
  } catch (error) {
    next(error)
  }
}

async function updateProcess(req, res, next) {
  try {
    res.json(await productionService.updateProcess(req.params.id, req.body))
  } catch (error) {
    next(error)
  }
}

async function listPurchaseRequests(_req, res, next) {
  try {
    res.json(await productionService.listPurchaseRequests())
  } catch (error) {
    next(error)
  }
}

async function createPurchaseRequest(req, res, next) {
  try {
    res.status(201).json(await productionService.createPurchaseRequest(req.body))
  } catch (error) {
    next(error)
  }
}

async function updatePurchaseRequest(req, res, next) {
  try {
    res.json(await productionService.updatePurchaseRequest(req.params.id, req.body))
  } catch (error) {
    next(error)
  }
}

async function getOperationsData(_req, res, next) {
  try {
    res.json(await operationsPlanningService.getOperationsData())
  } catch (error) {
    next(error)
  }
}

async function previewObjective(req, res, next) {
  try {
    res.json(await operationsPlanningService.previewObjective(req.body))
  } catch (error) {
    next(error)
  }
}

async function createObjective(req, res, next) {
  try {
    res.status(201).json(await operationsPlanningService.createObjective(req.body))
  } catch (error) {
    next(error)
  }
}

async function convertObjectiveToPlans(req, res, next) {
  try {
    res.json(await operationsPlanningService.convertObjectiveToPlans(req.params.id, req.body))
  } catch (error) {
    next(error)
  }
}

async function createManualPurchaseRequest(req, res, next) {
  try {
    res.status(201).json(await operationsPlanningService.createManualPurchaseRequest(req.body))
  } catch (error) {
    next(error)
  }
}

async function approvePurchaseRequest(req, res, next) {
  try {
    res.json(await operationsPlanningService.approvePurchaseRequest(req.params.id))
  } catch (error) {
    next(error)
  }
}

async function rejectPurchaseRequest(req, res, next) {
  try {
    res.json(await operationsPlanningService.rejectPurchaseRequest(req.params.id, req.body))
  } catch (error) {
    next(error)
  }
}

async function listPurchaseOrders(_req, res, next) {
  try {
    res.json(await operationsPlanningService.listPurchaseOrders())
  } catch (error) {
    next(error)
  }
}

async function createPurchaseOrder(req, res, next) {
  try {
    res.status(201).json(await operationsPlanningService.createPurchaseOrder(req.body))
  } catch (error) {
    next(error)
  }
}

async function convertPurchaseRequestToOrders(req, res, next) {
  try {
    res.status(201).json(await operationsPlanningService.convertPurchaseRequestToOrders(req.params.id, req.body))
  } catch (error) {
    next(error)
  }
}

async function approvePurchaseOrder(req, res, next) {
  try {
    res.json(await operationsPlanningService.approvePurchaseOrder(req.params.id))
  } catch (error) {
    next(error)
  }
}

async function receivePurchaseOrder(req, res, next) {
  try {
    res.json(await operationsPlanningService.receivePurchaseOrder(req.params.id, req.body))
  } catch (error) {
    next(error)
  }
}

async function recordQualityInspection(req, res, next) {
  try {
    res.json(await productionService.recordQualityInspection(req.params.id, req.body))
  } catch (error) {
    next(error)
  }
}

async function getConfiguration(_req, res, next) {
  try {
    res.json(await productionService.getConfiguration())
  } catch (error) {
    next(error)
  }
}

async function updateConfiguration(req, res, next) {
  try {
    res.json(await productionService.updateConfiguration(req.body))
  } catch (error) {
    next(error)
  }
}

module.exports = {
  calculatePlan,
  approveProductionOrder,
  approveRecipe,
  approveWasteRecord,
  approvePurchaseOrder,
  approvePurchaseRequest,
  convertObjectiveToPlans,
  convertPurchaseRequestToOrders,
  createManualPurchaseRequest,
  createObjective,
  createProcess,
  createPurchaseOrder,
  createProductionOrder,
  createPurchaseRequest,
  createRecipe,
  getConfiguration,
  getOperationsData,
  getOverview,
  listOrders,
  listWasteRecords,
  listProcesses,
  listPurchaseRequests,
  listPurchaseOrders,
  previewObjective,
  receivePurchaseOrder,
  rejectPurchaseRequest,
  recordProductionExecution,
  listRecipes,
  recordQualityInspection,
  reserveProductionOrderMaterials,
  updateConfiguration,
  updateProcess,
  updateProductionOrder,
  updatePurchaseRequest,
  updateRecipe,
}

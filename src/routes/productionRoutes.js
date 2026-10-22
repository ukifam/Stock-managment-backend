const router = require('express').Router()
const productionController = require('../controllers/productionController')
const { hasPermission } = require('../services/accessRoleService')

async function requireProductionApproval(req, _res, next) {
  try {
    if (await hasPermission(req.user, 'production', 'approve')) return next()
    return next(Object.assign(new Error('You do not have permission to approve production records. Please contact the owner of this task and ask them to do it.'), { status: 403 }))
  } catch (error) {
    next(error)
  }
}

async function requireProductionView(req, _res, next) {
  try {
    if (await hasPermission(req.user, 'production', 'view')) return next()
    return next(Object.assign(new Error('You do not have permission to view production waste records. Please contact the owner of this task and ask them to do it.'), { status: 403 }))
  } catch (error) {
    next(error)
  }
}

async function requireQualityPermission(req, _res, next) {
  try {
    const outcome = String(req.body?.result || '').trim().toUpperCase()
    const action = ['REWORK', 'REJECT', 'REJECTED'].includes(outcome) ? 'approve' : 'create'
    if (await hasPermission(req.user, 'quality', action)) return next()
    return next(Object.assign(new Error(`You do not have permission to ${action} quality records. Please contact the owner of this task and ask them to do it.`), { status: 403 }))
  } catch (error) {
    next(error)
  }
}

router.get('/', productionController.getOverview)
router.get('/operations', productionController.getOperationsData)
router.get('/configuration', productionController.getConfiguration)
router.put('/configuration', productionController.updateConfiguration)
router.get('/recipes', productionController.listRecipes)
router.post('/recipes', productionController.createRecipe)
router.patch('/recipes/:id', productionController.updateRecipe)
router.post('/recipes/:id/approve', requireProductionApproval, productionController.approveRecipe)
router.get('/processes', productionController.listProcesses)
router.post('/processes', productionController.createProcess)
router.patch('/processes/:id', productionController.updateProcess)
router.get('/plan', productionController.calculatePlan)
router.get('/orders', productionController.listOrders)
router.get('/waste', requireProductionView, productionController.listWasteRecords)
router.post('/waste/:id/approve', requireProductionApproval, productionController.approveWasteRecord)
router.post('/orders', productionController.createProductionOrder)
router.patch('/orders/:id', productionController.updateProductionOrder)
router.post('/orders/:id/approve', requireProductionApproval, productionController.approveProductionOrder)
router.post('/orders/:id/reserve', requireProductionApproval, productionController.reserveProductionOrderMaterials)
router.post('/orders/:id/execution', productionController.recordProductionExecution)
router.post('/orders/:id/quality', requireQualityPermission, productionController.recordQualityInspection)
router.post('/objectives/preview', productionController.previewObjective)
router.post('/objectives', productionController.createObjective)
router.post('/objectives/:id/convert', productionController.convertObjectiveToPlans)
router.get('/purchase-requests', productionController.listPurchaseRequests)
router.post('/purchase-requests', productionController.createPurchaseRequest)
router.post('/purchase-requests/manual', productionController.createManualPurchaseRequest)
router.patch('/purchase-requests/:id', productionController.updatePurchaseRequest)
router.post('/purchase-requests/:id/approve', requireProductionApproval, productionController.approvePurchaseRequest)
router.post('/purchase-requests/:id/reject', requireProductionApproval, productionController.rejectPurchaseRequest)
router.post('/purchase-requests/:id/purchase-orders', productionController.convertPurchaseRequestToOrders)
router.get('/purchase-orders', productionController.listPurchaseOrders)
router.post('/purchase-orders', productionController.createPurchaseOrder)
router.post('/purchase-orders/:id/approve', requireProductionApproval, productionController.approvePurchaseOrder)
router.post('/purchase-orders/:id/receive', productionController.receivePurchaseOrder)

module.exports = router

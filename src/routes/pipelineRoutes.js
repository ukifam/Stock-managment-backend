const router = require('express').Router()
const pipelineController = require('../controllers/pipelineController')
const { requirePermission } = require('../middleware/permissionMiddleware')

const canView = requirePermission('production', 'view')
const canPlan = requirePermission('production', 'create')

router.get('/', canView, pipelineController.listPipelines)
router.post('/', canPlan, pipelineController.upsertPipeline)
router.post('/bulk', canPlan, pipelineController.bulkUpsertPipelines)
router.delete('/:id', requirePermission('production', 'delete'), pipelineController.deletePipeline)

// Each step is done by the role that owns it.
router.get('/:id/stock-check', canView, pipelineController.getStockCheck)
router.post('/:id/submit', canPlan, pipelineController.runStep('submit'))
router.post('/:id/check-stock', canPlan, pipelineController.runStep('check-stock'))
router.post('/:id/recheck', canPlan, pipelineController.runStep('recheck'))
router.post('/:id/purchase-order', requirePermission('purchases', 'create'), pipelineController.runStep('purchase-order'))
router.post('/:id/pay', requirePermission('purchases', 'approve'), pipelineController.runStep('pay'))
router.post('/:id/receive', requirePermission('inventory', 'create'), pipelineController.runStep('receive'))
router.post('/:id/make', canPlan, pipelineController.runStep('make'))
router.post('/:id/quality', requirePermission('quality', 'create'), pipelineController.runStep('quality'))
router.post('/:id/store', requirePermission('inventory', 'create'), pipelineController.runStep('store'))

module.exports = router

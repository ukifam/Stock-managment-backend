const router = require('express').Router()
const qualityController = require('../controllers/qualityController')
const { requirePermission } = require('../middleware/permissionMiddleware')

router.get('/', requirePermission('quality', 'view'), qualityController.getOverview)
router.post('/standards', requirePermission('quality', 'create'), qualityController.createStandard)
router.patch('/standards/:id', requirePermission('quality', 'edit'), qualityController.updateStandard)
router.post('/inspections', requirePermission('quality', 'create'), qualityController.createInspection)
router.patch('/inspections/:id/disposition', requirePermission('quality', 'approve'), qualityController.setDisposition)

module.exports = router

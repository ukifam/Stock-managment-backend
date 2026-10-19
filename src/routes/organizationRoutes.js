const router = require('express').Router()
const { adminMiddleware } = require('../middleware/adminMiddleware')
const { requirePermission } = require('../middleware/permissionMiddleware')
const organizationController = require('../controllers/organizationController')

router.get('/', requirePermission('organization', 'view'), organizationController.getOrganization)
router.use(requirePermission('organization', 'edit'))
router.patch('/business', organizationController.updateBusiness)
router.post('/branches', organizationController.createBranch)
router.patch('/branches/:code', organizationController.updateBranch)
router.patch('/users/:id/branches', organizationController.assignUserBranches)

module.exports = router

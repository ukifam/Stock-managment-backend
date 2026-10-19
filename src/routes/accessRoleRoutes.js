const router = require('express').Router()
const controller = require('../controllers/accessRoleController')
const { requirePermission } = require('../middleware/permissionMiddleware')

router.get('/', requirePermission('users', 'view'), controller.listRoles)
router.post('/', requirePermission('users', 'create'), controller.createRole)
router.patch('/:code', requirePermission('users', 'edit'), controller.updateRole)

module.exports = router

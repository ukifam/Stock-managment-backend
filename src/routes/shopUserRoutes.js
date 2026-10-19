const router = require('express').Router()
const shopUserController = require('../controllers/shopUserController')
const { requirePermission } = require('../middleware/permissionMiddleware')

router.get('/', requirePermission('users', 'view'), shopUserController.listUsers)
router.post('/', requirePermission('users', 'create'), shopUserController.createUser)
router.patch('/:id', requirePermission('users', 'edit'), shopUserController.updateUser)

module.exports = router

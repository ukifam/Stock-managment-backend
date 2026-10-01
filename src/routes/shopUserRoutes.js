const router = require('express').Router()
const { shopAdminMiddleware } = require('../middleware/shopAdminMiddleware')
const shopUserController = require('../controllers/shopUserController')

router.use(shopAdminMiddleware)
router.get('/', shopUserController.listUsers)
router.post('/', shopUserController.createUser)
router.patch('/:id', shopUserController.updateUser)

module.exports = router

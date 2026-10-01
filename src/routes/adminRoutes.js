const router = require('express').Router()
const { adminMiddleware } = require('../middleware/adminMiddleware')
const adminController = require('../controllers/adminController')

router.use(adminMiddleware)
router.get('/overview', adminController.overview)
router.get('/users', adminController.listUsers)
router.post('/users', adminController.createUser)
router.patch('/users/:id', adminController.updateUser)

module.exports = router
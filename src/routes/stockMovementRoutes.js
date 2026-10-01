const express = require('express')
const controller = require('../controllers/stockMovementController')

const router = express.Router()

router.get('/', controller.listStockMovements)
router.get('/showcases/open', controller.listOpenShowcases)
router.post('/showcases', controller.sendToShowcase)
router.post('/showcases/:reference/close', controller.closeShowcase)
router.post('/adjust', controller.adjustStock)

module.exports = router

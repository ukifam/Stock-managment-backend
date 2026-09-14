const express = require('express')
const controller = require('../controllers/stockMovementController')

const router = express.Router()

router.get('/', controller.listStockMovements)
router.post('/adjust', controller.adjustStock)

module.exports = router

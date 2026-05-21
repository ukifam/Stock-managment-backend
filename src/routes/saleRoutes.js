const router = require('express').Router()
const saleController = require('../controllers/saleController')

router.get('/', saleController.listSales)
router.get('/available/items', saleController.getAvailableItems)
router.post('/', saleController.createSale)
router.patch('/:id/status', saleController.updateSaleStatus)

module.exports = router

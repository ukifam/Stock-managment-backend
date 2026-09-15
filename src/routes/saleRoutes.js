const router = require('express').Router()
const saleController = require('../controllers/saleController')

router.get('/', saleController.listSales)
router.get('/available/items', saleController.getAvailableItems)
router.post('/import', saleController.bulkImportSales)
router.post('/', saleController.createSale)
router.patch('/:id', saleController.updateSale)
router.patch('/:id/status', saleController.updateSaleStatus)
router.delete('/:id', saleController.deleteSale)

module.exports = router

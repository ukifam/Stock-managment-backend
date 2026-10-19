const router = require('express').Router()
const saleController = require('../controllers/saleController')
const { requirePermission } = require('../middleware/permissionMiddleware')

router.get('/', saleController.listSales)
router.get('/available/items', saleController.getAvailableItems)
router.post('/import', saleController.bulkImportSales)
router.get('/:id/returns', requirePermission('sales', 'view'), saleController.listSaleReturns)
router.post('/:id/returns', requirePermission('sales', 'create'), saleController.createSaleReturn)
router.patch('/returns/:returnId/approve', requirePermission('sales', 'approve'), saleController.approveSaleReturn)
router.patch('/returns/:returnId/reject', requirePermission('sales', 'approve'), saleController.rejectSaleReturn)
router.post('/', saleController.createSale)
router.patch('/:id', saleController.updateSale)
router.patch('/:id/status', saleController.updateSaleStatus)
router.delete('/:id', saleController.deleteSale)

module.exports = router

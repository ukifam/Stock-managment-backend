const router = require('express').Router()
const purchaseController = require('../controllers/purchaseController')

router.get('/', purchaseController.listPurchases)
router.post('/import', purchaseController.bulkImportPurchases)
router.post('/', purchaseController.createPurchase)
router.patch('/:id', purchaseController.updatePurchase)
router.patch('/:id/status', purchaseController.updatePurchaseStatus)

module.exports = router

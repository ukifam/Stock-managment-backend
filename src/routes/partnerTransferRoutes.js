const router = require('express').Router()
const controller = require('../controllers/partnerTransferController')
const shops = require('../controllers/branchTransferController')

// Stock moved between this business's own shops.
router.get('/shops', shops.listTransfers)
router.post('/shops', shops.sendTransfer)
router.post('/shops/:id/receive', shops.receiveTransfer)
router.post('/shops/:id/cancel', shops.cancelTransfer)

// Consignment stock held for outside partners.
router.get('/', controller.listTransfers)
router.post('/', controller.receiveTransfer)
router.post('/process', controller.processTransfer)
router.post('/:id/sell', controller.sellTransfer)
router.post('/:id/return', controller.returnTransfer)

module.exports = router

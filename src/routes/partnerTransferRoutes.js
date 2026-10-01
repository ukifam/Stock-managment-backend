const router = require('express').Router()
const controller = require('../controllers/partnerTransferController')

router.get('/', controller.listTransfers)
router.post('/', controller.receiveTransfer)
router.post('/:id/sell', controller.sellTransfer)
router.post('/:id/return', controller.returnTransfer)

module.exports = router
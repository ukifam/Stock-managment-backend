const router = require('express').Router()
const inventoryController = require('../controllers/inventoryController')

router.get('/', inventoryController.listInventory)
router.get('/:sku', inventoryController.getInventoryItem)
router.post('/', inventoryController.createInventoryItem)
router.patch('/:sku', inventoryController.updateInventoryItem)

module.exports = router

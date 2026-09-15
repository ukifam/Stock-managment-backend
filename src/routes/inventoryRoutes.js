const router = require('express').Router()
const inventoryController = require('../controllers/inventoryController')

router.get('/', inventoryController.listInventory)
router.post('/import', inventoryController.bulkImportInventory)
router.post('/', inventoryController.createInventoryItem)
router.get('/:sku', inventoryController.getInventoryItem)
router.patch('/:sku', inventoryController.updateInventoryItem)
router.delete('/:sku', inventoryController.deleteInventoryItem)

module.exports = router

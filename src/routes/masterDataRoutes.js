const router = require('express').Router()
const controller = require('../controllers/masterDataController')
const { requirePermission } = require('../middleware/permissionMiddleware')

router.get('/', requirePermission('inventory', 'view'), controller.getMasterData)

router.get('/units', requirePermission('inventory', 'view'), controller.listUnits)
router.post('/units', requirePermission('inventory', 'create'), controller.createUnit)
router.patch('/units/:code', requirePermission('inventory', 'edit'), controller.updateUnit)
router.get('/conversions', requirePermission('inventory', 'view'), controller.listConversions)
router.post('/conversions', requirePermission('inventory', 'create'), controller.createConversion)
router.patch('/conversions/:id', requirePermission('inventory', 'edit'), controller.updateConversion)

router.get('/suppliers', requirePermission('purchases', 'view'), controller.listSuppliers)
router.post('/suppliers', requirePermission('purchases', 'create'), controller.createSupplier)
router.patch('/suppliers/:id', requirePermission('purchases', 'edit'), controller.updateSupplier)
router.get('/customers', requirePermission('sales', 'view'), controller.listCustomers)
router.post('/customers', requirePermission('sales', 'create'), controller.createCustomer)
router.patch('/customers/:id', requirePermission('sales', 'edit'), controller.updateCustomer)

router.post('/items', requirePermission('inventory', 'create'), controller.createItem)
router.patch('/items/:sku', requirePermission('inventory', 'edit'), controller.updateItem)
router.get('/warehouses', requirePermission('inventory', 'view'), controller.listWarehouses)
router.post('/warehouses', requirePermission('inventory', 'create'), controller.createWarehouse)
router.patch('/warehouses/:code', requirePermission('inventory', 'edit'), controller.updateWarehouse)
router.get('/stock', requirePermission('inventory', 'view'), controller.listStock)
router.post('/stock/operations', requirePermission('inventory', 'create'), controller.recordStockOperation)

module.exports = router

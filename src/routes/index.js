const router = require('express').Router()
const healthController = require('../controllers/healthController')

router.get('/', healthController.root)
router.get('/api/health', healthController.health)
router.use('/api/dashboard', require('./dashboardRoutes'))
router.use('/api/inventory', require('./inventoryRoutes'))
router.use('/api/purchases', require('./purchaseRoutes'))
router.use('/api/sales', require('./saleRoutes'))
router.use('/api/reports', require('./reportRoutes'))
router.use('/api/settings', require('./settingsRoutes'))
router.use('/api/search', require('./searchRoutes'))
router.use('/api/venues', require('./venueRoutes'))
router.use('/api/expenses', require('./expenseRoutes'))

module.exports = router

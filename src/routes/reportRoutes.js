const router = require('express').Router()
const reportController = require('../controllers/reportController')
const { shopAdminMiddleware } = require('../middleware/shopAdminMiddleware')

router.get('/', reportController.getReports)
router.get('/weekly-email', shopAdminMiddleware, reportController.getWeeklyEmailStatus)
router.post('/weekly-email', shopAdminMiddleware, reportController.sendWeeklyEmailNow)

module.exports = router

const router = require('express').Router()
const reportController = require('../controllers/reportController')

router.get('/', reportController.getReports)

module.exports = router

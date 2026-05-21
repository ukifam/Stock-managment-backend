const router = require('express').Router()
const settingsController = require('../controllers/settingsController')

router.get('/', settingsController.getSettings)
router.patch('/', settingsController.updateSettings)

module.exports = router

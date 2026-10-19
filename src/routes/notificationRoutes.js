const router = require('express').Router()
const notificationController = require('../controllers/notificationController')

router.get('/', notificationController.listNotifications)
router.patch('/read-all', notificationController.markAllAsRead)
router.patch('/:id/read', notificationController.markAsRead)
router.post('/pipeline-activity', notificationController.recordPipelineActivity)

module.exports = router

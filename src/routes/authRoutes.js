const router = require('express').Router()
const authController = require('../controllers/authController')
const { authMiddleware } = require('../middleware/authMiddleware')

router.post('/register', authController.register)
router.post('/login', authController.login)
router.post('/password-reset/request', authController.requestPasswordReset)
router.post('/password-reset/confirm', authController.resetPassword)
router.get('/me', authMiddleware, authController.me)
router.post('/logout', authMiddleware, authController.logout)

module.exports = router

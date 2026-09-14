const express = require('express')
const router = express.Router()
const loanController = require('../controllers/loanController')

router.get('/metrics', loanController.getLoanMetrics)
router.get('/', loanController.listLoans)
router.get('/:id', loanController.getLoanById)
router.post('/', loanController.createLoan)
router.post('/:id/repayments', loanController.recordRepayment)
router.put('/:id', loanController.updateLoan)
router.delete('/:id', loanController.deleteLoan)

module.exports = router

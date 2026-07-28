const router = require('express').Router()
const expenseController = require('../controllers/expenseController')

router.get('/', expenseController.listExpenses)
router.get('/:id', expenseController.getExpense)
router.post('/', expenseController.createExpense)
router.patch('/:id', expenseController.updateExpense)

module.exports = router

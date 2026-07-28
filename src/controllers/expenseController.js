const expenseService = require('../services/expenseService')

async function listExpenses(req, res) {
  res.json(await expenseService.listExpenses(req.query))
}

async function getExpense(req, res) {
  res.json(await expenseService.getExpense(req.params.id))
}

async function createExpense(req, res) {
  res.status(201).json(await expenseService.createExpense(req.body))
}

async function updateExpense(req, res) {
  res.json(await expenseService.updateExpense(req.params.id, req.body))
}

module.exports = { listExpenses, getExpense, createExpense, updateExpense }

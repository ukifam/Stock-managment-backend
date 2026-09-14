const loanService = require('../services/loanService')

async function listLoans(req, res, next) {
  try {
    const { type, status, search, page, limit } = req.query
    const result = await loanService.listLoans({ type, status, search, page, limit })
    res.json(result)
  } catch (error) {
    next(error)
  }
}

async function getLoanById(req, res, next) {
  try {
    const loan = await loanService.getLoanById(req.params.id)
    res.json(loan)
  } catch (error) {
    next(error)
  }
}

async function createLoan(req, res, next) {
  try {
    const loan = await loanService.createLoan(req.body)
    res.status(201).json(loan)
  } catch (error) {
    next(error)
  }
}

async function recordRepayment(req, res, next) {
  try {
    const loan = await loanService.recordRepayment(req.params.id, req.body)
    res.json(loan)
  } catch (error) {
    next(error)
  }
}

async function updateLoan(req, res, next) {
  try {
    const loan = await loanService.updateLoan(req.params.id, req.body)
    res.json(loan)
  } catch (error) {
    next(error)
  }
}

async function deleteLoan(req, res, next) {
  try {
    const result = await loanService.deleteLoan(req.params.id)
    res.json(result)
  } catch (error) {
    next(error)
  }
}

async function getLoanMetrics(req, res, next) {
  try {
    const metrics = await loanService.getLoanMetrics()
    res.json(metrics)
  } catch (error) {
    next(error)
  }
}

module.exports = {
  listLoans,
  getLoanById,
  createLoan,
  recordRepayment,
  updateLoan,
  deleteLoan,
  getLoanMetrics,
}

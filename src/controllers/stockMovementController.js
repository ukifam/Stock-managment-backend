const stockMovementService = require('../services/stockMovementService')

async function listStockMovements(req, res) {
  res.json(await stockMovementService.listStockMovements(req.query))
}

async function adjustStock(req, res) {
  res.status(201).json(await stockMovementService.adjustStock(req.body))
}

async function sendToShowcase(req, res) {
  res.status(201).json(await stockMovementService.sendToShowcase(req.body))
}

async function listOpenShowcases(_req, res) {
  res.json(await stockMovementService.listOpenShowcases())
}

async function closeShowcase(req, res) {
  res.status(201).json(await stockMovementService.closeShowcase(req.params.reference, req.body))
}

module.exports = {
  listStockMovements,
  adjustStock,
  sendToShowcase,
  listOpenShowcases,
  closeShowcase,
}

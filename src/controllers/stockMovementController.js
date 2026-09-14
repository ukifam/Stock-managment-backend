const stockMovementService = require('../services/stockMovementService')

async function listStockMovements(req, res) {
  res.json(await stockMovementService.listStockMovements(req.query))
}

async function adjustStock(req, res) {
  res.status(201).json(await stockMovementService.adjustStock(req.body))
}

module.exports = {
  listStockMovements,
  adjustStock
}

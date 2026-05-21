const saleService = require('../services/saleService')

async function listSales(req, res) {
  res.json(await saleService.listSales(req.query))
}

async function getAvailableItems(req, res) {
  res.json(await saleService.getAvailableItems())
}

async function createSale(req, res) {
  res.status(201).json(await saleService.createSale(req.body))
}

async function updateSaleStatus(req, res) {
  res.json(await saleService.updateSaleStatus(req.params.id, req.body.status))
}

module.exports = {
  listSales,
  getAvailableItems,
  createSale,
  updateSaleStatus,
}

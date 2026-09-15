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

async function bulkImportSales(req, res) {
  res.status(201).json(await saleService.bulkImportSales(req.body.rows || req.body))
}

async function updateSaleStatus(req, res) {
  res.json(await saleService.updateSaleStatus(req.params.id, req.body.status))
}

async function updateSale(req, res) {
  res.json(await saleService.updateSale(req.params.id, req.body))
}

async function deleteSale(req, res) {
  res.json(await saleService.deleteSale(req.params.id))
}

module.exports = {
  listSales,
  getAvailableItems,
  createSale,
  bulkImportSales,
  updateSale,
  updateSaleStatus,
  deleteSale,
}

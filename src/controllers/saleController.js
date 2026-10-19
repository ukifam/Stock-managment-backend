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

async function listSaleReturns(req, res) {
  res.json(await saleService.listSaleReturns(req.params.id))
}

async function createSaleReturn(req, res) {
  res.status(201).json(await saleService.createSaleReturn(req.params.id, req.body))
}

async function approveSaleReturn(req, res) {
  res.json(await saleService.approveSaleReturn(req.params.returnId))
}

async function rejectSaleReturn(req, res) {
  res.json(await saleService.rejectSaleReturn(req.params.returnId))
}

module.exports = {
  listSales,
  getAvailableItems,
  createSale,
  bulkImportSales,
  updateSale,
  updateSaleStatus,
  deleteSale,
  listSaleReturns,
  createSaleReturn,
  approveSaleReturn,
  rejectSaleReturn,
}

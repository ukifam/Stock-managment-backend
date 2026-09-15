const purchaseService = require('../services/purchaseService')

async function listPurchases(req, res) {
  res.json(await purchaseService.listPurchases(req.query))
}

async function createPurchase(req, res) {
  res.status(201).json(await purchaseService.createPurchase(req.body))
}

async function bulkImportPurchases(req, res) {
  res.status(201).json(await purchaseService.bulkImportPurchases(req.body.rows || req.body))
}

async function updatePurchaseStatus(req, res) {
  res.json(await purchaseService.updatePurchaseStatus(req.params.id, req.body.status))
}

async function updatePurchase(req, res) {
  res.json(await purchaseService.updatePurchase(req.params.id, req.body))
}

async function deletePurchase(req, res) {
  res.json(await purchaseService.deletePurchase(req.params.id))
}

module.exports = {
  listPurchases,
  createPurchase,
  bulkImportPurchases,
  updatePurchase,
  updatePurchaseStatus,
  deletePurchase,
}

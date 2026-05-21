const purchaseService = require('../services/purchaseService')

async function listPurchases(req, res) {
  res.json(await purchaseService.listPurchases(req.query))
}

async function createPurchase(req, res) {
  res.status(201).json(await purchaseService.createPurchase(req.body))
}

async function updatePurchaseStatus(req, res) {
  res.json(await purchaseService.updatePurchaseStatus(req.params.id, req.body.status))
}

module.exports = {
  listPurchases,
  createPurchase,
  updatePurchaseStatus,
}

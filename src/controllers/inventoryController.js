const inventoryService = require('../services/inventoryService')

async function listInventory(req, res) {
  res.json(await inventoryService.listInventory(req.query))
}

async function getInventoryItem(req, res) {
  res.json(await inventoryService.getInventoryItem(req.params.sku))
}

async function createInventoryItem(req, res) {
  res.status(201).json(await inventoryService.createInventoryItem(req.body))
}

async function updateInventoryItem(req, res) {
  res.json(await inventoryService.updateInventoryItem(req.params.sku, req.body))
}

module.exports = {
  listInventory,
  getInventoryItem,
  createInventoryItem,
  updateInventoryItem,
}

const searchService = require('../services/searchService')

async function searchAll(req, res) {
  res.json(await searchService.searchAll(String(req.query.q || '')))
}

async function searchInventory(req, res) {
  res.json(await searchService.searchInventory(String(req.query.q || '')))
}

module.exports = {
  searchAll,
  searchInventory,
}

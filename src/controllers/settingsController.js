const settingsService = require('../services/settingsService')

async function getSettings(_req, res) {
  res.json(await settingsService.getSettings())
}

async function updateSettings(req, res) {
  res.json(await settingsService.updateSettings(req.body))
}

module.exports = {
  getSettings,
  updateSettings,
}

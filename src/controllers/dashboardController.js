const dashboardService = require('../services/dashboardService')

async function getDashboard(_req, res) {
  res.json(await dashboardService.getDashboard())
}

module.exports = {
  getDashboard,
}

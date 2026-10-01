const dashboardService = require('../services/dashboardService')

async function getDashboard(req, res) {
  const { from, to, category, stockStatus } = req.query
  res.json(await dashboardService.getDashboard({ from, to, category, stockStatus }))
}

module.exports = {
  getDashboard,
}

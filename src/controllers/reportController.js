const reportService = require('../services/reportService')

async function getReports(req, res) {
  res.json(await reportService.getReports(req.query))
}

module.exports = {
  getReports,
}

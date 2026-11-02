const crypto = require('crypto')
const reportService = require('../services/reportService')
const weeklyReports = require('../services/weeklyReportScheduler')
const httpError = require('../utils/httpError')
const { currentTenant } = require('../utils/tenantContext')

async function getReports(req, res) {
  res.json(await reportService.getReports(req.query))
}

async function getWeeklyEmailStatus(_req, res) {
  res.json(await weeklyReports.weeklyReportStatus(currentTenant().ownerKey))
}

async function sendWeeklyEmailNow(_req, res) {
  res.json(await weeklyReports.sendWeeklyReportNow(currentTenant().ownerKey))
}

// Lets an external scheduler (e.g. cron-job.org) wake the server and send any due reports.
async function runWeeklyReportJob(req, res) {
  const secret = String(process.env.CRON_SECRET || '')
  const provided = String(req.headers['x-cron-secret'] || req.query.secret || '')
  if (!secret) throw httpError(404, 'Not found')
  const valid = provided.length === secret.length && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret))
  if (!valid) throw httpError(401, 'Invalid job secret')
  res.json(await weeklyReports.sendDueWeeklyReports())
}

module.exports = {
  getReports,
  getWeeklyEmailStatus,
  runWeeklyReportJob,
  sendWeeklyEmailNow,
}

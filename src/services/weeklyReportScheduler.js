const nodemailer = require('nodemailer')
const Business = require('../models/Business')
const Branch = require('../models/Branch')
const User = require('../models/User')
const httpError = require('../utils/httpError')
const { ownerKeyForUser, runWithTenant } = require('../utils/tenantContext')
const reportService = require('./reportService')
const { createWeeklyReportPdf } = require('./weeklyReportPdf')

const TIME_ZONE = 'Africa/Kigali'
const KIGALI_UTC_OFFSET_HOURS = 2
const WEEKLY_REPORT_HOUR = 16
const WEEKLY_REPORT_MINUTE = 0
const CHECK_INTERVAL_MS = 10 * 60 * 1000
const RETRY_AFTER_MS = 60 * 60 * 1000
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

let interval
let checking = false
const lastFailureAt = new Map()

// A timer alone misses the send whenever the server is asleep or restarting at
// 16:00 (common on free hosting). Instead, check regularly and catch up on any
// week that is due but not yet recorded as sent.
function startWeeklyReportScheduler() {
  if (interval) return
  const check = () => {
    if (checking) return
    checking = true
    sendDueWeeklyReports()
      .catch((error) => console.error('[WEEKLY REPORT] Check failed:', error))
      .finally(() => { checking = false })
  }
  setTimeout(check, 30 * 1000).unref?.()
  interval = setInterval(check, CHECK_INTERVAL_MS)
  interval.unref?.()
  console.info(`[WEEKLY REPORT] Fridays at 16:00 ${TIME_ZONE}; next run ${nextFridayRun(new Date()).toISOString()}. Email ${emailConfigured() ? 'configured' : 'NOT configured (set SMTP_HOST and SMTP_FROM)'}.`)
}

function nextFridayRun(now) {
  const local = dateParts(now)
  const localDate = new Date(Date.UTC(local.year, local.month - 1, local.day))
  const daysUntilFriday = (5 - localDate.getUTCDay() + 7) % 7
  const candidateDay = new Date(localDate)
  candidateDay.setUTCDate(candidateDay.getUTCDate() + daysUntilFriday)
  if (daysUntilFriday === 0 && (local.hour > WEEKLY_REPORT_HOUR || (local.hour === WEEKLY_REPORT_HOUR && local.minute >= WEEKLY_REPORT_MINUTE))) {
    candidateDay.setUTCDate(candidateDay.getUTCDate() + 7)
  }
  return new Date(Date.UTC(candidateDay.getUTCFullYear(), candidateDay.getUTCMonth(), candidateDay.getUTCDate(), WEEKLY_REPORT_HOUR - KIGALI_UTC_OFFSET_HOURS, WEEKLY_REPORT_MINUTE))
}

function latestDueRun(now) {
  return new Date(nextFridayRun(now).getTime() - WEEK_MS)
}

async function sendDueWeeklyReports(now = new Date()) {
  const transport = createTransport()
  if (!transport) return { sent: 0, skipped: 'Email is not configured' }
  const due = latestDueRun(now)
  const period = reportingPeriod(due)
  const businesses = await Business.find({
    active: { $ne: false },
    weeklyReportSentFor: { $ne: period.to },
    createdAt: { $lte: due },
  }).lean()

  let sent = 0
  for (const business of businesses) {
    const failedAt = lastFailureAt.get(business.ownerKey)
    if (failedAt && now.getTime() - failedAt < RETRY_AFTER_MS) continue
    // Claim the week first so two server instances never send it twice.
    const claimed = await Business.updateOne(
      { _id: business._id, weeklyReportSentFor: { $ne: period.to } },
      { $set: { weeklyReportSentFor: period.to, weeklyReportSentAt: new Date() } },
    )
    if (!claimed.modifiedCount) continue
    try {
      await sendBusinessReport({ business, period, ...transport })
      lastFailureAt.delete(business.ownerKey)
      sent += 1
    } catch (error) {
      lastFailureAt.set(business.ownerKey, now.getTime())
      await Business.updateOne(
        { _id: business._id, weeklyReportSentFor: period.to },
        { $set: { weeklyReportSentFor: business.weeklyReportSentFor || '', weeklyReportSentAt: business.weeklyReportSentAt || null } },
      )
      console.error(`[WEEKLY REPORT] Could not send report for ${business.name || business.ownerKey}: ${error.message}`)
    }
  }
  return { sent, period }
}

// Sends the last seven days to the current shop's admins right away.
async function sendWeeklyReportNow(ownerKey, now = new Date()) {
  const transport = createTransport()
  if (!transport) throw httpError(503, 'Email is not configured on the server (SMTP_HOST and SMTP_FROM are missing)')
  const business = await Business.findOne({ ownerKey }).lean()
  if (!business) throw httpError(404, 'Set up your business before sending reports')
  const period = reportingPeriod(now)
  try {
    const recipients = await sendBusinessReport({ business, period, ...transport })
    return { recipients, period }
  } catch (error) {
    if (error.status) throw error
    throw httpError(502, `The email server rejected the report: ${error.message}`)
  }
}

async function weeklyReportStatus(ownerKey, now = new Date()) {
  const business = await Business.findOne({ ownerKey }).select('ownerKey ownerEmail weeklyReportSentFor weeklyReportSentAt').lean()
  return {
    emailConfigured: emailConfigured(),
    schedule: `Fridays 16:00 (${TIME_ZONE})`,
    nextRun: nextFridayRun(now).toISOString(),
    lastSentFor: business?.weeklyReportSentFor || '',
    lastSentAt: business?.weeklyReportSentAt || null,
    recipients: business ? await reportRecipients(business) : [],
  }
}

// The shop owner plus every active administrator of the shop.
async function reportRecipients(business) {
  const admins = await User.find({ role: 'admin', active: { $ne: false } }).select('email ownerKey').lean()
  const emails = [
    business.ownerEmail,
    ...admins.filter((admin) => ownerKeyForUser(admin) === business.ownerKey).map((admin) => admin.email),
  ]
  return [...new Set(emails.map((email) => String(email || '').trim().toLowerCase()).filter((email) => email.includes('@')))]
}

async function sendBusinessReport({ business, period, from, mailer }) {
  const recipients = await reportRecipients(business)
  if (!recipients.length) throw httpError(400, 'No administrator email address is available for this business')
  const branches = await Branch.find({ ownerKey: business.ownerKey, active: { $ne: false } }).sort({ code: 1 }).lean()
  const reportBranches = branches.length ? branches : [{ code: 'MAIN', name: 'Main branch' }]
  const sections = []
  for (const branch of reportBranches) {
    const tenantUser = {
      id: `weekly-report:${business.ownerKey}`,
      email: recipients[0],
      ownerEmail: business.ownerEmail || recipients[0],
      ownerKey: business.ownerKey,
      branchCode: branch.code,
      role: 'admin',
      username: 'Weekly report scheduler',
    }
    const report = await runWithTenant(tenantUser, () => reportService.getReports({ from: period.from, to: period.to }))
    sections.push({ name: branch.name || branch.code, report })
  }
  const pdf = createWeeklyReportPdf({ ...period, sections })
  const filename = `weekly-report-${period.to}.pdf`
  await mailer.sendMail({
    from,
    to: recipients,
    subject: `Weekly business report | ${business.name || 'Business'} | ${period.from} to ${period.to}`,
    text: `Your weekly business report for ${period.from} to ${period.to} (${TIME_ZONE}) is attached as a PDF.`,
    attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
  })
  console.info(`[WEEKLY REPORT] Sent ${filename} for ${business.name || business.ownerKey} to ${recipients.length} recipient(s).`)
  return recipients
}

function emailConfigured() {
  return Boolean(String(process.env.SMTP_HOST || '').trim() && String(process.env.SMTP_FROM || process.env.SMTP_USER || '').trim())
}

function createTransport() {
  if (!emailConfigured()) return null
  const host = String(process.env.SMTP_HOST).trim()
  const from = String(process.env.SMTP_FROM || process.env.SMTP_USER).trim()
  const port = Number(process.env.SMTP_PORT || 587)
  const user = String(process.env.SMTP_USER || '').trim()
  const password = String(process.env.SMTP_PASSWORD || '')
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465
  return {
    from: from.includes('<') ? from : `"TRI LTD Business Suite" <${from}>`,
    mailer: nodemailer.createTransport({
      host,
      port,
      secure,
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      ...(user && password ? { auth: { user, pass: password } } : {}),
      tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
    }),
  }
}

function reportingPeriod(now) {
  const end = dateParts(now)
  const endDate = new Date(Date.UTC(end.year, end.month - 1, end.day))
  const startDate = new Date(endDate)
  startDate.setUTCDate(startDate.getUTCDate() - 6)
  return { from: formatDate(startDate), to: formatDate(endDate) }
}

function dateParts(date) {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  return Object.fromEntries(values.map(({ type, value }) => [type, Number(value)]))
}

function formatDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

module.exports = {
  latestDueRun,
  nextFridayRun,
  reportingPeriod,
  sendDueWeeklyReports,
  sendWeeklyReportNow,
  startWeeklyReportScheduler,
  weeklyReportStatus,
}

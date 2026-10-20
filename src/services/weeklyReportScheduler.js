const nodemailer = require('nodemailer')
const Business = require('../models/Business')
const Branch = require('../models/Branch')
const Setting = require('../models/Setting')
const { runWithTenant } = require('../utils/tenantContext')
const reportService = require('./reportService')
const { createWeeklyReportPdf } = require('./weeklyReportPdf')

const TIME_ZONE = 'Africa/Kigali'
const WEEKLY_REPORT_HOUR = 16
const WEEKLY_REPORT_MINUTE = 0
let timer

function startWeeklyReportScheduler() {
  if (timer) return
  const scheduleNext = () => {
    const delay = Math.max(1000, nextFridayRun(new Date()).getTime() - Date.now())
    timer = setTimeout(async () => {
      timer = undefined
      await sendWeeklyReports().catch((error) => console.error('[WEEKLY REPORT] Scheduled send failed:', error))
      scheduleNext()
    }, delay)
    timer.unref?.()
  }
  scheduleNext()
  console.info('[WEEKLY REPORT] Scheduled for Fridays at 16:00 Africa/Kigali.')
}

function nextFridayRun(now) {
  const local = dateParts(now)
  const localDate = new Date(Date.UTC(local.year, local.month - 1, local.day))
  const daysUntilFriday = (5 - localDate.getUTCDay() + 7) % 7
  let candidateDay = new Date(localDate)
  candidateDay.setUTCDate(candidateDay.getUTCDate() + daysUntilFriday)
  if (daysUntilFriday === 0 && (local.hour > WEEKLY_REPORT_HOUR || (local.hour === WEEKLY_REPORT_HOUR && local.minute >= WEEKLY_REPORT_MINUTE))) {
    candidateDay.setUTCDate(candidateDay.getUTCDate() + 7)
  }
  return new Date(Date.UTC(candidateDay.getUTCFullYear(), candidateDay.getUTCMonth(), candidateDay.getUTCDate(), WEEKLY_REPORT_HOUR - 2, WEEKLY_REPORT_MINUTE))
}

async function sendWeeklyReports(now = new Date()) {
  const transport = createTransport()
  if (!transport) {
    console.warn('[WEEKLY REPORT] SMTP is not configured; weekly PDF emails were not sent.')
    return
  }
  const { from, mailer } = transport
  const period = reportingPeriod(now)
  const businesses = await Business.find({ active: true }).lean()
  for (const business of businesses) {
    try {
      await sendBusinessReport({ business, period, from, mailer })
    } catch (error) {
      console.error(`[WEEKLY REPORT] Could not send report for ${business.name || business.ownerKey}:`, error)
    }
  }
}

async function sendBusinessReport({ business, period, from, mailer }) {
  const settings = await Setting.findOne({ ownerKey: business.ownerKey }).lean()
  const recipient = String(business.ownerEmail || settings?.profile?.email || business.email || '').trim()
  if (!recipient) {
    console.warn(`[WEEKLY REPORT] Skipping ${business.name || business.ownerKey}: no owner email is configured.`)
    return
  }
  const branches = await Branch.find({ ownerKey: business.ownerKey, active: true }).sort({ code: 1 }).lean()
  const reportBranches = branches.length ? branches : [{ code: 'MAIN', name: 'Main branch' }]
  const sections = []
  for (const branch of reportBranches) {
    const tenantUser = {
      id: `weekly-report:${business.ownerKey}`,
      email: recipient,
      ownerEmail: business.ownerEmail || recipient,
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
    to: recipient,
    subject: `Weekly business report | ${business.name || 'Business'} | ${period.from} to ${period.to}`,
    text: `Your weekly business report for ${period.from} to ${period.to} (Africa/Kigali) is attached as a PDF.`,
    attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
  })
  console.info(`[WEEKLY REPORT] Sent ${filename} to ${recipient}.`)
}

function createTransport() {
  const host = String(process.env.SMTP_HOST || '').trim()
  const from = String(process.env.SMTP_FROM || process.env.SMTP_USER || '').trim()
  if (!host || !from) return null
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

module.exports = { startWeeklyReportScheduler, nextFridayRun, reportingPeriod, sendWeeklyReports }

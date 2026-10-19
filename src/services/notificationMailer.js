const nodemailer = require('nodemailer')

/**
 * Sends an email notification to the shop admin when a worker completes or executes
 * a stage in the production pipeline.
 */
async function sendProductionActivityEmail({
  adminEmail,
  workerName,
  workerRole,
  stageLabel,
  productName,
  pipelineId,
  details = '',
  metrics = {},
}) {
  if (!adminEmail) return false

  const host = String(process.env.SMTP_HOST || '').trim()
  const from = String(process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@tri-business.com').trim()

  const metricsHtml = Object.entries(metrics)
    .filter(([_, v]) => v !== undefined && v !== null && v !== '')
    .map(
      ([key, val]) => `
      <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 13px;">
        <span style="color: #94a3b8; text-transform: capitalize;">${key.replace(/([A-Z])/g, ' $1')}:</span>
        <strong style="color: #f8fafc;">${String(val)}</strong>
      </div>
    `
    )
    .join('')

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; margin: 0; padding: 32px 16px; color: #f8fafc;">
      <div style="max-width: 540px; margin: 0 auto; background: #1e293b; border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.1); overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.4);">
        <div style="background: linear-gradient(135deg, #1e293b, #0f172a); padding: 28px 24px; text-align: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
          <div style="display: inline-block; width: 44px; height: 44px; line-height: 44px; border-radius: 12px; background: linear-gradient(135deg, #3b82f6, #6366f1); color: #ffffff; font-weight: 800; font-size: 20px; margin-bottom: 10px;">🏭</div>
          <h2 style="color: #ffffff; margin: 0; font-size: 19px; font-weight: 700;">TRI LTD | Production Alert</h2>
          <p style="color: #94a3b8; margin: 4px 0 0; font-size: 12px;">Stage Execution Notification</p>
        </div>

        <div style="padding: 28px 24px;">
          <div style="background: rgba(99, 102, 241, 0.12); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 10px; padding: 12px 16px; margin-bottom: 20px;">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #818cf8; font-weight: 700;">Worker Action Logged</div>
            <div style="font-size: 16px; font-weight: 700; color: #ffffff; margin-top: 4px;">
              ${workerName} executed "${stageLabel}"
            </div>
            <div style="font-size: 12px; color: #cbd5e1; margin-top: 2px;">
              Role: <strong style="color: #60a5fa;">${workerRole || 'Staff Member'}</strong>
            </div>
          </div>

          <div style="background: rgba(15, 23, 42, 0.5); border-radius: 10px; padding: 16px; border: 1px solid rgba(255,255,255,0.06); margin-bottom: 20px;">
            <div style="font-size: 12px; color: #94a3b8; margin-bottom: 8px; font-weight: 600;">BATCH DETAILS</div>
            <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 13px;">
              <span style="color: #94a3b8;">Product:</span>
              <strong style="color: #f8fafc;">${productName || 'Batch Product'}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 13px;">
              <span style="color: #94a3b8;">Batch / Pipeline ID:</span>
              <strong style="color: #a5b4fc; font-family: monospace;">${pipelineId}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 13px;">
              <span style="color: #94a3b8;">Stage Completed:</span>
              <strong style="color: #34d399;">${stageLabel}</strong>
            </div>
            ${metricsHtml}
            ${
              details
                ? `<div style="margin-top: 10px; font-size: 12px; color: #94a3b8;">
                    <strong>Execution Notes:</strong>
                    <p style="margin: 4px 0 0; color: #cbd5e1; font-style: italic;">${details}</p>
                   </div>`
                : ''
            }
          </div>

          <div style="text-align: center; margin-top: 24px;">
            <p style="font-size: 12px; color: #94a3b8; margin: 0 0 12px;">
              Sign in to your Business Suite dashboard to view complete batch analytics and real-time status.
            </p>
          </div>
        </div>

        <div style="padding: 16px 24px; background: rgba(15, 23, 42, 0.6); border-top: 1px solid rgba(255, 255, 255, 0.08); font-size: 11px; color: #64748b; text-align: center;">
          This notification was automatically sent to the shop administrator (${adminEmail}).<br>
          &copy; TRI LTD Business Suite · Production &amp; Inventory Systems
        </div>
      </div>
    </body>
    </html>
  `

  if (!host) {
    console.info(`[PRODUCTION PIPELINE EMAIL ALERT]`)
    console.info(`  To: ${adminEmail}`)
    console.info(`  Worker: ${workerName} (${workerRole})`)
    console.info(`  Action: Executed stage "${stageLabel}" on product "${productName}" (Batch: ${pipelineId})`)
    console.info(`  Details: ${details || 'None'}`)
    console.info(`  (SMTP_HOST not set; email logged for local development)`)
    return false
  }

  const port = Number(process.env.SMTP_PORT || 587)
  const user = String(process.env.SMTP_USER || '').trim()
  const password = String(process.env.SMTP_PASSWORD || '')
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465

  try {
    const transport = nodemailer.createTransport({
      host,
      port,
      secure,
      ...(user && password ? { auth: { user, pass: password } } : {}),
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === 'production',
      },
    })

    await transport.sendMail({
      from,
      to: adminEmail,
      subject: `[TRI Production Alert] ${workerName} completed "${stageLabel}" on ${productName || pipelineId}`,
      html,
    })
    console.info(`[PRODUCTION EMAIL SENT] Notification delivered to ${adminEmail}`)
    return true
  } catch (err) {
    console.error(`[PRODUCTION EMAIL ERROR] Failed to deliver to ${adminEmail}:`, err.message)
    return false
  }
}

module.exports = {
  sendProductionActivityEmail,
}

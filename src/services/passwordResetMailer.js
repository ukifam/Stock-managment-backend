const nodemailer = require('nodemailer')

async function sendPasswordResetEmail({ email, resetUrl }) {
  const host = String(process.env.SMTP_HOST || '').trim()
  const from = String(process.env.SMTP_FROM || process.env.SMTP_USER || '').trim()
  if (!host || !from) {
    console.warn(`[PASSWORD RESET] Email was NOT sent to "${email}" because SMTP is not configured in .env (SMTP_HOST & SMTP_FROM are required).`)
    console.info(`[PASSWORD RESET LINK for ${email}]: ${resetUrl}`)
    return false
  }

  const port = Number(process.env.SMTP_PORT || 587)
  const user = String(process.env.SMTP_USER || '').trim()
  const password = String(process.env.SMTP_PASSWORD || '')
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    ...(user && password ? { auth: { user, pass: password } } : {}),
    tls: {
      rejectUnauthorized: process.env.NODE_ENV === 'production',
    },
  })

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; margin: 0; padding: 32px 16px; color: #f8fafc;">
      <div style="max-width: 520px; margin: 0 auto; background: #1e293b; border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.1); overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.4);">
        <div style="background: linear-gradient(135deg, #1e293b, #0f172a); padding: 32px 24px; text-align: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
          <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; border-radius: 12px; background: linear-gradient(135deg, #3b82f6, #6366f1); color: #ffffff; font-weight: 800; font-size: 22px; margin-bottom: 12px;">T</div>
          <h2 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 700;">TRI LTD | Business Suite</h2>
          <p style="color: #94a3b8; margin: 6px 0 0; font-size: 13px;">Security & Account Recovery</p>
        </div>
        <div style="padding: 32px 28px;">
          <h3 style="margin-top: 0; color: #f8fafc; font-size: 18px; font-weight: 600;">Reset Your Password</h3>
          <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1;">
            We received a request to reset the password for your account (<strong>${email}</strong>). Click the button below to choose a new password:
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${resetUrl}" style="display: inline-block; background: #2563eb; color: #ffffff !important; padding: 14px 32px; border-radius: 8px; font-weight: 600; text-decoration: none; font-size: 14px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35);">
              Reset Password
            </a>
          </div>
          <p style="font-size: 13px; line-height: 1.5; color: #94a3b8;">
            This link is valid for <strong>15 minutes</strong>. If the button above does not work, copy and paste this link into your browser:
          </p>
          <div style="background: rgba(15, 23, 42, 0.6); padding: 12px 14px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.08); word-break: break-all; font-size: 12px; color: #60a5fa; font-family: monospace;">
            ${resetUrl}
          </div>
        </div>
        <div style="padding: 20px 28px; background: rgba(15, 23, 42, 0.5); border-top: 1px solid rgba(255, 255, 255, 0.08); font-size: 12px; color: #64748b; line-height: 1.5;">
          If you did not request this password reset, please ignore this email. Your password will remain unchanged.<br>
          &copy; TRI LTD Business Suite
        </div>
      </div>
    </body>
    </html>
  `

  await transport.sendMail({
    from: from.includes('<') ? from : `"TRI LTD Suite" <${from}>`,
    to: email,
    subject: 'Reset your TRI LTD Business Suite password',
    text: `Use this secure link to set a new password for your TRI LTD Business Suite account. It expires in 15 minutes:\n\n${resetUrl}`,
    html,
  })
  console.info(`[PASSWORD RESET] Email successfully sent to ${email}`)
  return true
}

module.exports = { sendPasswordResetEmail }


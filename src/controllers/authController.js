const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const User = require('../models/User')
const Business = require('../models/Business')
const Branch = require('../models/Branch')
const httpError = require('../utils/httpError')
const { JWT_SECRET } = require('../middleware/authMiddleware')
const { normalizeRole } = require('../utils/roles')
const { MAIN_BRANCH_CODE, ownerKeyForUser } = require('../utils/tenantContext')
const { getEffectivePermissions } = require('../services/accessRoleService')
const { sendPasswordResetEmail } = require('../services/passwordResetMailer')

async function register(req, res, next) {
  try {
    const { username, email, password } = req.body
    if (!username || !email || !password) {
      throw httpError(400, 'Username, email, and password are required')
    }
    if (String(password).length < 8) throw httpError(400, 'Password must be at least 8 characters')

    const normalizedEmail = email.toLowerCase().trim()
    const existing = await User.findOne({ email: normalizedEmail })
    if (existing) {
      throw httpError(409, 'An account with this email already exists')
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const user = await User.create({
      username: username.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: 'admin',
      accessRoleCode: 'administrator',
      ownerKey: normalizedEmail,
      ownerEmail: normalizedEmail,
      branchCodes: [MAIN_BRANCH_CODE],
      defaultBranchCode: MAIN_BRANCH_CODE,
      active: true,
    })

    await Business.create({
      ownerKey: normalizedEmail,
      ownerEmail: normalizedEmail,
      name: `${username.trim()}'s Business`,
      email: normalizedEmail,
      active: true,
    })
    await Branch.create({
      ownerKey: normalizedEmail,
      ownerEmail: normalizedEmail,
      name: 'Main Branch',
      code: MAIN_BRANCH_CODE,
      active: true,
    })

    const token = issueToken(user)

    res.status(201).json({
      token,
      user: serializeSessionUser(user),
    })
  } catch (error) {
    next(error)
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      throw httpError(400, 'Email and password are required')
    }

    const normalizedEmail = email.toLowerCase().trim()
    const user = await User.findOne({ email: normalizedEmail })
    if (!user) {
      throw httpError(401, 'Invalid email or password')
    }

    if (user.active === false) throw httpError(403, 'This account is disabled')

    const business = await Business.findOne({ ownerKey: ownerKeyForUser(user) }).lean()
    if (business && business.active === false) throw httpError(403, 'This business is inactive')

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      throw httpError(401, 'Invalid email or password')
    }

    const token = issueToken(user)

    res.json({
      token,
      user: serializeSessionUser(user),
    })
  } catch (error) {
    next(error)
  }
}

async function me(req, res, next) {
  try {
    const user = await User.findById(req.user.id).select('-password')
    if (!user) {
      throw httpError(404, 'User not found')
    }

    res.json({ ...serializeSessionUser(user), permissions: await getEffectivePermissions(req.user) })
  } catch (error) {
    next(error)
  }
}

async function requestPasswordReset(req, res, next) {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase()
    if (!email) {
      throw httpError(400, 'Please enter your account email address')
    }

    const user = await User.findOne({ email })
    let resetToken
    let emailSent = false
    const isDev = allowsDevelopmentResetToken()

    if (!user) {
      if (isDev) {
        throw httpError(404, `No account found for "${email}". Please check the spelling or create an account.`)
      }
      return res.json({
        message: 'If that account exists, password reset instructions have been sent.',
        emailSent: false,
      })
    }

    if (user.active === false) {
      throw httpError(403, 'This account is currently disabled. Please contact an administrator.')
    }

    resetToken = crypto.randomBytes(32).toString('hex')
    user.passwordResetTokenHash = hashResetToken(resetToken)
    user.passwordResetExpiresAt = new Date(Date.now() + 15 * 60 * 1000)
    await user.save()

    const resetUrl = resetUrlFor(resetToken)
    try {
      emailSent = await sendPasswordResetEmail({ email: user.email, resetUrl })
    } catch (error) {
      console.error(`Password reset email could not be sent for ${user.email}:`, error)
    }

    if (isDev) {
      console.info(`[DEV AUTH] Password reset token for ${user.email}: ${resetToken}`)
      console.info(`[DEV AUTH] Direct reset link: ${resetUrl}`)
    }

    let message = ''
    if (emailSent) {
      message = `Password reset instructions have been sent to ${user.email}. Please check your inbox and spam folder.`
    } else if (isDev) {
      message = `SMTP email is not configured on the server, so no email could be dispatched. A direct reset token has been auto-filled below.`
    } else {
      message = 'If that account exists, password reset instructions have been sent.'
    }

    res.json({
      message,
      emailSent: Boolean(emailSent),
      email: user.email,
      ...(isDev && resetToken ? { resetToken, resetUrl } : {}),
    })
  } catch (error) {
    next(error)
  }
}

async function resetPassword(req, res, next) {
  try {
    const token = String(req.body?.token || '').trim()
    const password = String(req.body?.password || '')
    if (!token || password.length < 8) throw httpError(400, 'A valid reset token and a password of at least 8 characters are required')
    const user = await User.findOne({
      passwordResetTokenHash: hashResetToken(token),
      passwordResetExpiresAt: { $gt: new Date() },
      active: { $ne: false },
    })
    if (!user) throw httpError(400, 'This password reset token is invalid or has expired')
    user.password = await bcrypt.hash(password, 10)
    user.passwordResetTokenHash = ''
    user.passwordResetExpiresAt = null
    user.sessionVersion = Number(user.sessionVersion || 0) + 1
    await user.save()
    res.json({ message: 'Password reset complete. You can now sign in.' })
  } catch (error) {
    next(error)
  }
}

async function logout(req, res, next) {
  try {
    const user = await User.findById(req.user.id)
    if (user) {
      user.sessionVersion = Number(user.sessionVersion || 0) + 1
      await user.save()
    }
    res.status(204).end()
  } catch (error) {
    next(error)
  }
}

function issueToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      email: user.email,
      username: user.username,
      role: normalizeRole(user.role),
      ownerKey: user.ownerKey,
      ownerEmail: user.ownerEmail,
      accessRoleCode: user.accessRoleCode || '',
      branchCodes: user.branchCodes,
      defaultBranchCode: user.defaultBranchCode,
      sessionVersion: Number(user.sessionVersion || 0),
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  )
}

function serializeSessionUser(user) {
  return {
    id: user._id.toString(),
    username: user.username,
    email: user.email,
    role: normalizeRole(user.role),
    shopRole: user.shopRole || 'sales_associate',
    ownerKey: user.ownerKey,
    accessRoleCode: user.accessRoleCode || '',
    branchCodes: user.branchCodes || [],
    defaultBranchCode: user.defaultBranchCode || MAIN_BRANCH_CODE,
  }
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function allowsDevelopmentResetToken() {
  return process.env.PASSWORD_RESET_DEV_TOKEN === 'true' || process.env.NODE_ENV !== 'production' || !process.env.SMTP_HOST
}

function resetUrlFor(token) {
  const clientUrl = process.env.CLIENT_APP_URL || 'http://localhost:5173'
  const url = new URL(clientUrl)
  url.searchParams.set('page', 'forgot-password')
  url.searchParams.set('token', token)
  return url.toString()
}

module.exports = {
  register,
  login,
  me,
  logout,
  requestPasswordReset,
  resetPassword,
}

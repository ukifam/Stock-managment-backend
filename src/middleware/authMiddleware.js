const jwt = require('jsonwebtoken')
const httpError = require('../utils/httpError')
const { ownerKeyForUser, runWithTenant } = require('../utils/tenantContext')
const User = require('../models/User')
const { isSystemAdmin, normalizeRole } = require('../utils/roles')

const JWT_SECRET = process.env.JWT_SECRET || 'stock-super-secret-key-2026'

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(httpError(401, 'No authorization token provided'))
  }

  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    const account = await User.findById(decoded.id).select('-password').lean()
    if (!account || account.active === false) throw httpError(401, 'Account is unavailable')

    const user = {
      id: account._id.toString(),
      email: account.email,
      username: account.username,
      role: normalizeRole(account.role),
      ownerKey: account.ownerKey,
      ownerEmail: account.ownerEmail,
    }
    const hasSystemAdminRole = isSystemAdmin(user.role)
    const isAdminEndpoint = /^\/(api\/)?admin(?:\/|$)/.test(req.originalUrl)
    const isIdentityEndpoint = /^\/(api\/)?auth\/me(?:\?|$)/.test(req.originalUrl)

    if (hasSystemAdminRole && !isAdminEndpoint && !isIdentityEndpoint) {
      const selectedOwnerKey = String(req.headers['x-shop-owner-key'] || '').trim()
      if (!selectedOwnerKey) throw httpError(403, 'Select a shop from System Admin before opening shop operations')
      const requestedShopKey = selectedOwnerKey.toLowerCase()
      const shopUsers = await User.find({ role: 'admin', active: { $ne: false } })
        .select('_id email ownerKey')
        .lean()
      const shopUser = shopUsers.find((shop) => (
        ownerKeyForUser(shop).toLowerCase() === requestedShopKey
        || String(shop.email || '').toLowerCase() === requestedShopKey
      ))
      if (!shopUser) throw httpError(403, 'The selected shop is unavailable')
      user.ownerKey = ownerKeyForUser(shopUser)
      user.ownerEmail = shopUser.email
    }

    req.user = user
    runWithTenant(user, next)
  } catch (err) {
    if (err.status) return next(err)
    next(httpError(401, 'Invalid or expired token'))
  }
}

module.exports = { authMiddleware, JWT_SECRET }

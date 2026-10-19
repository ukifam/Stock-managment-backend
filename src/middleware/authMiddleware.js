const jwt = require('jsonwebtoken')
const httpError = require('../utils/httpError')
const { ownerKeyForUser, runWithTenant } = require('../utils/tenantContext')
const User = require('../models/User')
const Business = require('../models/Business')
const Branch = require('../models/Branch')
const { isSystemAdmin, normalizeRole } = require('../utils/roles')
const { MAIN_BRANCH_CODE, normalizeBranchCode } = require('../utils/tenantContext')

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
    if (Number(decoded.sessionVersion || 0) !== Number(account.sessionVersion || 0)) {
      throw httpError(401, 'Your session has ended. Please sign in again')
    }

    const user = {
      id: account._id.toString(),
      email: account.email,
      username: account.username,
      role: normalizeRole(account.role),
      shopRole: account.shopRole || 'sales_associate',
      ownerKey: account.ownerKey,
      ownerEmail: account.ownerEmail,
      accessRoleCode: account.accessRoleCode || '',
      branchCodes: account.branchCodes || [],
      defaultBranchCode: account.defaultBranchCode || MAIN_BRANCH_CODE,
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

    if (!hasSystemAdminRole) {
      const business = await Business.findOne({ ownerKey: ownerKeyForUser(account) }).select('active').lean()
      if (business && business.active === false) throw httpError(403, 'This business is inactive')
    } else if (user.ownerKey) {
      const business = await Business.findOne({ ownerKey: user.ownerKey }).select('active').lean()
      if (business && business.active === false) throw httpError(403, 'This business is inactive')
    }

    const isOrganizationEndpoint = /^\/(api\/)?organization(?:\/|$)/.test(req.originalUrl)
    const branchRows = await Branch.find({ ownerKey: user.ownerKey, active: { $ne: false } }).select('code').lean()
    const availableBranchCodes = branchRows.length ? branchRows.map((branch) => normalizeBranchCode(branch.code)) : [MAIN_BRANCH_CODE]
    const isBusinessAdmin = user.role === 'admin' || hasSystemAdminRole
    const assignedBranchCodes = isBusinessAdmin
      ? availableBranchCodes
      : (user.branchCodes.length ? user.branchCodes.map(normalizeBranchCode) : [MAIN_BRANCH_CODE])
    const requestedBranchCode = isOrganizationEndpoint ? '' : String(req.headers['x-branch-code'] || '').trim()
    const branchCode = normalizeBranchCode(requestedBranchCode || user.defaultBranchCode || assignedBranchCodes[0])
    if (!availableBranchCodes.includes(branchCode)) throw httpError(403, 'The selected branch is unavailable')
    if (!isBusinessAdmin && !assignedBranchCodes.includes(branchCode)) throw httpError(403, 'Your account is not assigned to the selected branch')
    user.branchCode = branchCode
    user.branchCodes = assignedBranchCodes

    req.user = user
    runWithTenant(user, next)
  } catch (err) {
    if (err.status) return next(err)
    next(httpError(401, 'Invalid or expired token'))
  }
}

module.exports = { authMiddleware, JWT_SECRET }

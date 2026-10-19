const httpError = require('../utils/httpError')
const { normalizeRole } = require('../utils/roles')
const { hasPermission } = require('../services/accessRoleService')

async function businessAdminMiddleware(req, _res, next) {
  const role = normalizeRole(req.user?.role)
  if (role === 'admin' || role === 'system_admin') return next()
  try {
    if (await hasPermission(req.user, 'organization', 'edit')) return next()
  } catch (error) {
    return next(error)
  }
  return next(httpError(403, 'Business administrator access is required'))
}

module.exports = { businessAdminMiddleware }

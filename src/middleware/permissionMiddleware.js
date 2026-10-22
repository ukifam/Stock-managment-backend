const httpError = require('../utils/httpError')
const { hasPermission } = require('../services/accessRoleService')

function requirePermission(module, action) {
  return async (req, _res, next) => {
    try {
      if (await hasPermission(req.user, module, action)) return next()
      return next(httpError(403, `You do not have permission to ${action} ${module.replace(/_/g, ' ')} records. Please contact the owner of this task and ask them to do it.`))
    } catch (error) {
      next(error)
    }
  }
}

module.exports = { requirePermission }

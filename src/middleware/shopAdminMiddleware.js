const httpError = require('../utils/httpError')
const { normalizeRole } = require('../utils/roles')

function shopAdminMiddleware(req, _res, next) {
  if (normalizeRole(req.user?.role) !== 'admin') {
    return next(httpError(403, 'Shop administrator access is required'))
  }
  next()
}

module.exports = { shopAdminMiddleware }

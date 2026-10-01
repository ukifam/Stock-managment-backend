const httpError = require('../utils/httpError')
const { isSystemAdmin } = require('../utils/roles')

function adminMiddleware(req, _res, next) {
  if (!isSystemAdmin(req.user?.role)) {
    return next(httpError(403, 'System administrator access is required'))
  }
  next()
}

module.exports = { adminMiddleware }

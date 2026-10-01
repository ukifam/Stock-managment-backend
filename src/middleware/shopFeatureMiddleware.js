const httpError = require('../utils/httpError')
const { normalizeRole } = require('../utils/roles')

function shopFeatureMiddleware(feature) {
  return (req, _res, next) => {
    const role = normalizeRole(req.user?.role)
    if (role === 'admin' || role === 'system_admin') return next()

    const allowedFeatures = new Set(['dashboard', 'inventory', 'sales', 'expenses', 'transfers', 'search'])
    if (role === 'staff' && allowedFeatures.has(feature)) return next()

    return next(httpError(403, 'Your staff account does not have access to this area'))
  }
}

module.exports = { shopFeatureMiddleware }

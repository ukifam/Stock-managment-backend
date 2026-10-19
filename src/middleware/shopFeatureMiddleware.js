const httpError = require('../utils/httpError')
const { hasPermission } = require('../services/accessRoleService')

function shopFeatureMiddleware(feature) {
  return async (req, _res, next) => {
    try {
      const action = actionForRequest(req)
      if (await hasPermission(req.user, feature, action)) return next()
      return next(httpError(403, `You do not have permission to ${action} this module`))
    } catch (error) {
      next(error)
    }
  }
}

function actionForRequest(req) {
  if (req.method === 'GET') return req.query?.export || /export/i.test(req.path) ? 'export' : 'view'
  if (req.method === 'DELETE') return 'delete'
  const status = String(req.body?.status || req.body?.outcome || '').toUpperCase()
  if (status.includes('CANCEL')) return 'cancel'
  if (/\/(status|quality|approve|reject)(?:\/|$)/i.test(req.path)) return 'approve'
  if (req.method === 'POST') return 'create'
  return 'edit'
}

module.exports = { actionForRequest, shopFeatureMiddleware }

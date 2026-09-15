const jwt = require('jsonwebtoken')
const httpError = require('../utils/httpError')
const { runWithTenant } = require('../utils/tenantContext')

const JWT_SECRET = process.env.JWT_SECRET || 'stock-super-secret-key-2026'

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(httpError(401, 'No authorization token provided'))
  }

  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    req.user = decoded
    runWithTenant(decoded, next)
  } catch (err) {
    next(httpError(401, 'Invalid or expired token'))
  }
}

module.exports = { authMiddleware, JWT_SECRET }

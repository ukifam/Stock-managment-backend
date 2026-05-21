function errorHandler(error, _req, res, _next) {
  const status = error.status || 500
  const payload = { message: error.message || 'Server error' }

  if (error.fields) payload.fields = error.fields

  res.status(status).json(payload)
}

module.exports = errorHandler

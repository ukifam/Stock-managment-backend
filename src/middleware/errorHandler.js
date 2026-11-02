function errorHandler(error, _req, res, _next) {
  let status = error.status || error.statusCode || 500
  let message = error.message || 'Server error'

  if (error.name === 'ValidationError') status = 400
  else if (error.name === 'CastError') {
    status = 400
    message = `Invalid value for ${error.path}`
  } else if (error.code === 11000) {
    status = 409
    message = `A record with this ${Object.keys(error.keyValue || {}).join(', ') || 'value'} already exists`
  } else if (error.type === 'entity.parse.failed') {
    status = 400
    message = 'Request body is not valid JSON'
  } else if (error.type === 'entity.too.large') {
    status = 413
    message = 'Request body is too large'
  }

  if (status >= 500) console.error(error)
  const payload = { message: status >= 500 && process.env.NODE_ENV === 'production' ? 'Server error' : message }
  if (error.fields) payload.fields = error.fields

  res.status(status).json(payload)
}

module.exports = errorHandler

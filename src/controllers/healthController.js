function root(_req, res) {
  res.json({
    name: 'stock-backend',
    status: 'ok',
    endpoints: ['/api/dashboard', '/api/inventory', '/api/purchases', '/api/sales', '/api/reports', '/api/settings', '/api/search'],
  })
}

function health(_req, res) {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
}

module.exports = {
  root,
  health,
}

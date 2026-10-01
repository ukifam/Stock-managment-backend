function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function isSystemAdmin(role) {
  return normalizeRole(role) === 'system_admin'
}

module.exports = { normalizeRole, isSystemAdmin }

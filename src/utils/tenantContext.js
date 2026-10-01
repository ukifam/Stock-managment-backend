const { AsyncLocalStorage } = require('async_hooks')

const LEGACY_OWNER_EMAIL = 'info@ukifam.com'
const LEGACY_OWNER_KEY = 'legacy'

const storage = new AsyncLocalStorage()

function normalizeEmail(email = '') {
  return String(email || '').trim().toLowerCase()
}

function ownerKeyForUser(user) {
  const explicitOwnerKey = String(user?.ownerKey || '').trim()
  if (explicitOwnerKey) return explicitOwnerKey
  const email = normalizeEmail(user?.email)
  if (!email || email === LEGACY_OWNER_EMAIL) return LEGACY_OWNER_KEY
  return email
}

function ownerEmailForUser(user) {
  const explicitOwnerEmail = normalizeEmail(user?.ownerEmail)
  if (explicitOwnerEmail) return explicitOwnerEmail
  const email = normalizeEmail(user?.email)
  return email || LEGACY_OWNER_EMAIL
}

function tenantForUser(user) {
  if (String(user?.role || '').toLowerCase() === 'system_admin' && !user?.ownerKey) {
    return { ownerKey: null, ownerEmail: normalizeEmail(user?.email) }
  }
  return {
    ownerKey: ownerKeyForUser(user),
    ownerEmail: ownerEmailForUser(user),
  }
}

function runWithTenant(user, callback) {
  return storage.run(tenantForUser(user), callback)
}

function currentTenant() {
  return storage.getStore() || tenantForUser(null)
}

function tenantFilter() {
  const { ownerKey } = currentTenant()
  if (!ownerKey) throw new Error('A shop must be selected before accessing shop data')
  if (ownerKey === LEGACY_OWNER_KEY) {
    return {
      $or: [
        { ownerKey: LEGACY_OWNER_KEY },
        { ownerKey: { $exists: false } },
        { ownerEmail: LEGACY_OWNER_EMAIL },
        { ownerEmail: { $exists: false } },
      ],
    }
  }

  return { ownerKey }
}

function scopedQuery(query = {}) {
  const filter = tenantFilter()
  if (filter.$or && query.$or) {
    return { $and: [filter, query] }
  }

  return { ...filter, ...query }
}

function withTenantFields(record = {}) {
  const { ownerKey, ownerEmail } = currentTenant()
  return {
    ...record,
    ownerKey,
    ownerEmail,
  }
}

module.exports = {
  LEGACY_OWNER_EMAIL,
  LEGACY_OWNER_KEY,
  currentTenant,
  ownerKeyForUser,
  runWithTenant,
  scopedQuery,
  tenantFilter,
  withTenantFields,
}

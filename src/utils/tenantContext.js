const { AsyncLocalStorage } = require('async_hooks')

const LEGACY_OWNER_EMAIL = 'info@ukifam.com'
const LEGACY_OWNER_KEY = 'legacy'
const MAIN_BRANCH_CODE = 'MAIN'

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
    return {
      ownerKey: null,
      ownerEmail: normalizeEmail(user?.email),
      userEmail: normalizeEmail(user?.email),
      username: String(user?.username || ''),
      branchCode: null,
      role: user?.role,
      userId: user?.id,
    }
  }
  return {
    ownerKey: ownerKeyForUser(user),
    ownerEmail: ownerEmailForUser(user),
    userEmail: normalizeEmail(user?.email),
    username: String(user?.username || ''),
    branchCode: normalizeBranchCode(user?.branchCode),
    branchCodes: Array.isArray(user?.branchCodes) ? user.branchCodes.map(normalizeBranchCode) : [],
    role: String(user?.role || '').toLowerCase(),
    userId: user?.id ? String(user.id) : '',
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

function branchFilter() {
  const branchCode = currentBranchCode()
  if (branchCode === MAIN_BRANCH_CODE) {
    return {
      $or: [
        { branchCode: MAIN_BRANCH_CODE },
        { branchCode: { $exists: false } },
        { branchCode: '' },
        { branchCode: null },
      ],
    }
  }
  return { branchCode }
}

function branchScopedQuery(query = {}) {
  return { $and: [tenantFilter(), branchFilter(), query] }
}

function withTenantFields(record = {}) {
  const { ownerKey, ownerEmail } = currentTenant()
  return {
    ...record,
    ownerKey,
    ownerEmail,
  }
}

function withBranchFields(record = {}) {
  return {
    ...withTenantFields(record),
    branchCode: currentBranchCode(),
    createdBy: record.createdBy || auditActor(),
    updatedBy: auditActor(),
  }
}

function auditActor() {
  const tenant = currentTenant()
  return {
    id: tenant.userId || '',
    username: tenant.username || '',
    email: tenant.userEmail || tenant.ownerEmail || '',
  }
}

function currentBranchCode() {
  return normalizeBranchCode(currentTenant().branchCode)
}

function normalizeBranchCode(value) {
  const normalized = String(value || MAIN_BRANCH_CODE).trim().toUpperCase()
  return normalized || MAIN_BRANCH_CODE
}

module.exports = {
  LEGACY_OWNER_EMAIL,
  LEGACY_OWNER_KEY,
  MAIN_BRANCH_CODE,
  auditActor,
  branchFilter,
  branchScopedQuery,
  currentBranchCode,
  currentTenant,
  normalizeBranchCode,
  ownerKeyForUser,
  runWithTenant,
  scopedQuery,
  tenantFilter,
  withBranchFields,
  withTenantFields,
}

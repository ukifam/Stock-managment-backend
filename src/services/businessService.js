const Branch = require('../models/Branch')
const Business = require('../models/Business')
const Setting = require('../models/Setting')
const User = require('../models/User')
const httpError = require('../utils/httpError')
const { MAIN_BRANCH_CODE, currentTenant, ownerKeyForUser } = require('../utils/tenantContext')
const { businessFeatures } = require('../utils/businessFeatures')

const BUSINESS_TEMPLATES = ['cafe', 'bakery', 'restaurant', 'maize_mill', 'juice_producer', 'furniture_workshop', 'soap_manufacturer', 'cosmetics', 'agro_processor', 'retail_shop', 'electronics_store', 'other']

async function getOrganization() {
  const tenant = currentTenant()
  const business = await ensureBusiness()
  const branches = await Branch.find({ ownerKey: tenant.ownerKey }).sort({ name: 1 }).lean()
  const isAdministrator = tenant.role === 'admin' || tenant.role === 'system_admin'
  const accessibleBranchCodes = isAdministrator
    ? branches.filter((branch) => branch.active !== false).map((branch) => branch.code)
    : normalizeCodes(tenant.branchCodes)
  const visibleBranches = isAdministrator ? branches : branches.filter((branch) => accessibleBranchCodes.includes(branch.code))
  const users = isAdministrator ? await listBusinessUsers(branches) : []

  return {
    business: serializeBusiness(business),
    features: businessFeatures(business.template, business.processingEnabled),
    branches: visibleBranches.map(serializeBranch),
    users,
    activeBranchCode: tenant.branchCode || MAIN_BRANCH_CODE,
    accessibleBranchCodes,
    templates: BUSINESS_TEMPLATES,
  }
}

async function getBusinessFeatures() {
  const tenant = currentTenant()
  if (!tenant.ownerKey) throw httpError(403, 'Select a business before checking available features')
  const business = await Business.findOne({ ownerKey: tenant.ownerKey }).select('template processingEnabled').lean()
  if (!business) throw httpError(404, 'Business not found')
  const template = business.template || 'other'
  return { template, features: businessFeatures(template, business.processingEnabled) }
}

async function updateBusiness(payload = {}) {
  const business = await ensureBusiness()
  const next = normalizeBusiness(payload, business.toObject())
  Object.assign(business, next)
  await business.save()

  if (payload.currency !== undefined) {
    await Setting.updateOne(
      { ownerKey: business.ownerKey },
      {
        $set: {
          ownerEmail: business.ownerEmail,
          'financial.currency': business.currency,
        },
      },
      { upsert: true }
    )
  }

  return serializeBusiness(business)
}

async function createBranch(payload = {}) {
  const tenant = currentTenant()
  await ensureBusiness()
  const branch = normalizeBranch(payload)
  const existing = await Branch.findOne({ ownerKey: tenant.ownerKey, code: branch.code }).lean()
  if (existing) throw httpError(409, 'A branch with this code already exists')

  const created = await Branch.create({
    ...branch,
    ownerKey: tenant.ownerKey,
    ownerEmail: tenant.ownerEmail,
  })
  return serializeBranch(created)
}

async function updateBranch(code, payload = {}) {
  const tenant = currentTenant()
  const branch = await Branch.findOne({ ownerKey: tenant.ownerKey, code: normalizeCode(code) })
  if (!branch) throw httpError(404, 'Branch not found')
  if (branch.code === MAIN_BRANCH_CODE && payload.active === false) {
    throw httpError(400, 'The Main Branch cannot be deactivated')
  }

  const next = normalizeBranch({ ...branch.toObject(), ...payload }, branch.toObject())
  if (next.code !== branch.code) throw httpError(400, 'A branch code cannot be changed after creation')
  Object.assign(branch, next)
  await branch.save()
  return serializeBranch(branch)
}

async function assignUserBranches(userId, payload = {}) {
  const tenant = currentTenant()
  const branchCodes = normalizeCodes(payload.branchCodes)
  if (branchCodes.length === 0) throw httpError(400, 'Assign the user to at least one branch')

  const branches = await Branch.find({ ownerKey: tenant.ownerKey, code: { $in: branchCodes }, active: { $ne: false } }).lean()
  if (branches.length !== branchCodes.length) throw httpError(400, 'One or more selected branches are unavailable')

  const user = await User.findById(userId)
  if (!user || user.role === 'system_admin' || ownerKeyForUser(user) !== tenant.ownerKey) {
    throw httpError(404, 'Business user not found')
  }
  user.branchCodes = branchCodes
  user.defaultBranchCode = branchCodes.includes(user.defaultBranchCode) ? user.defaultBranchCode : branchCodes[0]
  await user.save()
  return serializeUser(user)
}

async function ensureBusiness() {
  const tenant = currentTenant()
  if (!tenant.ownerKey) throw httpError(403, 'Select a business before opening organization settings')
  let business = await Business.findOne({ ownerKey: tenant.ownerKey })
  if (!business) {
    const settings = await Setting.findOne({ ownerKey: tenant.ownerKey }).lean()
    business = await Business.create({
      ownerKey: tenant.ownerKey,
      ownerEmail: tenant.ownerEmail,
      name: settings?.profile?.displayName || 'My Business',
      email: tenant.ownerEmail,
      currency: settings?.financial?.currency || 'RWF',
      active: true,
    })
  }
  await Branch.updateOne(
    { ownerKey: tenant.ownerKey, code: MAIN_BRANCH_CODE },
    {
      $setOnInsert: {
        ownerKey: tenant.ownerKey,
        ownerEmail: tenant.ownerEmail,
        name: 'Main Branch',
        code: MAIN_BRANCH_CODE,
        active: true,
      },
    },
    { upsert: true }
  )
  return business
}

async function listBusinessUsers(branches) {
  const tenant = currentTenant()
  const rows = await User.find({ role: { $in: ['admin', 'staff'] } }).select('-password').sort({ username: 1 }).lean()
  return rows
    .filter((user) => ownerKeyForUser(user) === tenant.ownerKey)
    .map((user) => serializeUser(user, branches))
}

function normalizeBusiness(payload, fallback = {}) {
  const template = String(payload.template ?? fallback.template ?? 'other').trim().toLowerCase()
  if (!BUSINESS_TEMPLATES.includes(template)) throw httpError(400, 'Choose a valid business template')
  const currency = String(payload.currency ?? fallback.currency ?? 'RWF').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw httpError(400, 'Currency must be a three-letter code')
  const name = String(payload.name ?? fallback.name ?? '').trim()
  if (!name) throw httpError(400, 'Business name is required')
  const tax = payload.tax ?? fallback.tax ?? {}

  const normalized = {
    name,
    address: String(payload.address ?? fallback.address ?? '').trim(),
    phone: String(payload.phone ?? fallback.phone ?? '').trim(),
    email: String(payload.email ?? fallback.email ?? '').trim().toLowerCase(),
    logoUrl: String(payload.logoUrl ?? fallback.logoUrl ?? '').trim(),
    currency,
    tax: {
      taxNumber: String(tax.taxNumber ?? '').trim(),
      taxRate: numberAtLeastZero(tax.taxRate, 0),
      taxInclusive: Boolean(tax.taxInclusive),
    },
    template,
    active: payload.active === undefined ? fallback.active !== false : Boolean(payload.active),
  }
  if (payload.processingEnabled !== undefined) normalized.processingEnabled = Boolean(payload.processingEnabled)
  else if (typeof fallback.processingEnabled === 'boolean') normalized.processingEnabled = fallback.processingEnabled
  return normalized
}

function normalizeBranch(payload, fallback = {}) {
  const name = String(payload.name ?? fallback.name ?? '').trim()
  const code = normalizeCode(payload.code ?? fallback.code)
  if (!name || !code) throw httpError(400, 'Branch name and code are required')

  return {
    name,
    code,
    address: String(payload.address ?? fallback.address ?? '').trim(),
    phone: String(payload.phone ?? fallback.phone ?? '').trim(),
    email: String(payload.email ?? fallback.email ?? '').trim().toLowerCase(),
    manager: String(payload.manager ?? fallback.manager ?? '').trim(),
    active: payload.active === undefined ? fallback.active !== false : Boolean(payload.active),
    warehouses: normalizeWarehouses(payload.warehouses ?? fallback.warehouses),
  }
}

function normalizeWarehouses(warehouses = []) {
  return (Array.isArray(warehouses) ? warehouses : []).map((warehouse) => ({
    name: String(warehouse.name || '').trim(),
    code: normalizeCode(warehouse.code),
    address: String(warehouse.address || '').trim(),
    active: warehouse.active !== false,
  })).filter((warehouse) => warehouse.name && warehouse.code)
}

function serializeBusiness(business) {
  const source = business.toObject ? business.toObject() : business
  return {
    id: String(source._id),
    name: source.name,
    address: source.address || '',
    phone: source.phone || '',
    email: source.email || '',
    logoUrl: source.logoUrl || '',
    currency: source.currency || 'RWF',
    tax: {
      taxNumber: source.tax?.taxNumber || '',
      taxRate: Number(source.tax?.taxRate || 0),
      taxInclusive: Boolean(source.tax?.taxInclusive),
    },
    template: source.template || 'other',
    processingEnabled: businessFeatures(source.template, source.processingEnabled).processing,
    active: source.active !== false,
  }
}

function serializeBranch(branch) {
  const source = branch.toObject ? branch.toObject() : branch
  return {
    id: String(source._id),
    name: source.name,
    code: source.code,
    address: source.address || '',
    phone: source.phone || '',
    email: source.email || '',
    manager: source.manager || '',
    active: source.active !== false,
    warehouses: (source.warehouses || []).map((warehouse) => ({
      name: warehouse.name,
      code: warehouse.code,
      address: warehouse.address || '',
      active: warehouse.active !== false,
    })),
  }
}

function serializeUser(user, branches = []) {
  const source = user.toObject ? user.toObject() : user
  const isAdmin = source.role === 'admin'
  return {
    id: String(source._id),
    username: source.username,
    email: source.email,
    role: source.role,
    shopRole: source.shopRole || '',
    accessRoleCode: source.accessRoleCode || '',
    active: source.active !== false,
    branchCodes: isAdmin ? branches.map((branch) => branch.code) : normalizeCodes(source.branchCodes),
    defaultBranchCode: source.defaultBranchCode || MAIN_BRANCH_CODE,
  }
}

function normalizeCodes(codes) {
  return [...new Set((Array.isArray(codes) ? codes : []).map(normalizeCode).filter(Boolean))]
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '')
}

function numberAtLeastZero(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

module.exports = {
  BUSINESS_TEMPLATES,
  assignUserBranches,
  createBranch,
  getBusinessFeatures,
  ensureBusiness,
  getOrganization,
  updateBranch,
  updateBusiness,
}

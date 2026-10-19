const AccessRole = require('../models/AccessRole')
const httpError = require('../utils/httpError')
const { currentTenant } = require('../utils/tenantContext')
const {
  BUILTIN_ROLE_TEMPLATES,
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  defaultRoleCodeForUser,
  normalizePermissionActions,
  normalizePermissionModule,
} = require('../utils/permissionCatalog')

const initializedTenants = new Set()

async function ensureDefaultRoles() {
  const tenant = currentTenant()
  if (!tenant.ownerKey) throw httpError(403, 'Select a business before accessing roles')
  if (initializedTenants.has(tenant.ownerKey)) return

  await AccessRole.bulkWrite(BUILTIN_ROLE_TEMPLATES.map((template) => ({
    updateOne: {
      filter: { ownerKey: tenant.ownerKey, code: template.code },
      update: {
        $set: {
          permissions: template.permissions,
          name: template.name,
          description: template.description,
          builtIn: true,
          active: true,
        },
        $setOnInsert: {
          ownerKey: tenant.ownerKey,
          ownerEmail: tenant.ownerEmail,
          code: template.code,
        },
      },
      upsert: true,
    },
  })))
  initializedTenants.add(tenant.ownerKey)
}

async function listRoles() {
  const tenant = currentTenant()
  await ensureDefaultRoles()
  const roles = await AccessRole.find({ ownerKey: tenant.ownerKey }).sort({ builtIn: -1, name: 1 }).lean()
  return {
    modules: PERMISSION_MODULES,
    actions: PERMISSION_ACTIONS,
    roles: roles.map(serializeRole),
  }
}

async function createRole(payload = {}) {
  const tenant = currentTenant()
  await ensureDefaultRoles()
  const role = normalizeRolePayload(payload)
  if (BUILTIN_ROLE_TEMPLATES.some((template) => template.code === role.code)) {
    throw httpError(409, 'That role code is reserved by a built-in role')
  }
  if (await AccessRole.findOne({ ownerKey: tenant.ownerKey, code: role.code }).lean()) {
    throw httpError(409, 'A role with this code already exists')
  }
  const created = await AccessRole.create({
    ...role,
    ownerKey: tenant.ownerKey,
    ownerEmail: tenant.ownerEmail,
    builtIn: false,
    createdBy: actorFromTenant(tenant),
  })
  return serializeRole(created)
}

async function updateRole(code, payload = {}) {
  const tenant = currentTenant()
  const role = await AccessRole.findOne({ ownerKey: tenant.ownerKey, code: normalizeRoleCode(code) })
  if (!role) throw httpError(404, 'Role not found')
  if (role.builtIn) throw httpError(400, 'Built-in roles cannot be changed')

  const next = normalizeRolePayload({ ...role.toObject(), ...payload }, role.toObject())
  if (next.code !== role.code) throw httpError(400, 'A role code cannot be changed after creation')
  Object.assign(role, next)
  await role.save()
  return serializeRole(role)
}

async function hasPermission(user, module, action) {
  const normalizedModule = normalizePermissionModule(module)
  const normalizedAction = String(action || '').trim().toLowerCase()
  if (!normalizedModule || !PERMISSION_ACTIONS.includes(normalizedAction)) return false

  const permissions = await getEffectivePermissions(user)
  return Boolean(permissions.find((permission) => permission.module === normalizedModule)?.actions.includes(normalizedAction))
}

async function getEffectivePermissions(user) {
  const accountRole = String(user?.role || '').toLowerCase()
  if (accountRole === 'admin' || accountRole === 'system_admin') {
    return PERMISSION_MODULES.map((module) => ({ module, actions: [...PERMISSION_ACTIONS] }))
  }

  await ensureDefaultRoles()
  const tenant = currentTenant()
  const roleCode = normalizeRoleCode(user?.accessRoleCode || defaultRoleCodeForUser(user))
  const role = await AccessRole.findOne({ ownerKey: tenant.ownerKey, code: roleCode, active: { $ne: false } }).lean()
  return role?.permissions || []
}

async function assertAssignableRole(code, accountType = 'staff') {
  const normalized = normalizeRoleCode(code || (accountType === 'admin' ? 'administrator' : 'cashier'))
  await ensureDefaultRoles()
  const tenant = currentTenant()
  const role = await AccessRole.findOne({ ownerKey: tenant.ownerKey, code: normalized, active: { $ne: false } }).lean()
  if (!role) throw httpError(400, 'Select an active access role')
  return normalized
}

function normalizeRolePayload(payload = {}, fallback = {}) {
  const name = String(payload.name ?? fallback.name ?? '').trim()
  if (!name) throw httpError(400, 'Role name is required')
  const code = normalizeRoleCode(payload.code ?? fallback.code ?? name)
  if (!code) throw httpError(400, 'Role code is required')
  const permissions = normalizePermissions(payload.permissions ?? fallback.permissions ?? [])
  if (!permissions.length) throw httpError(400, 'Assign at least one module permission')
  return {
    name,
    code,
    description: String(payload.description ?? fallback.description ?? '').trim(),
    permissions,
    active: payload.active === undefined ? fallback.active !== false : Boolean(payload.active),
  }
}

function normalizePermissions(permissions) {
  const merged = new Map()
  for (const entry of Array.isArray(permissions) ? permissions : []) {
    const module = normalizePermissionModule(entry?.module)
    const actions = normalizePermissionActions(entry?.actions)
    if (!module || !actions.length) continue
    merged.set(module, [...new Set([...(merged.get(module) || []), ...actions])])
  }
  return [...merged.entries()].map(([module, actions]) => ({ module, actions }))
}

function normalizeRoleCode(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
}

function actorFromTenant(tenant) {
  return { id: tenant.userId || '', username: tenant.username || '', email: tenant.userEmail || tenant.ownerEmail || '' }
}

function serializeRole(role) {
  const source = role.toObject ? role.toObject() : role
  return {
    id: String(source._id),
    name: source.name,
    code: source.code,
    description: source.description || '',
    permissions: source.permissions || [],
    builtIn: Boolean(source.builtIn),
    active: source.active !== false,
  }
}

module.exports = {
  assertAssignableRole,
  createRole,
  getEffectivePermissions,
  hasPermission,
  listRoles,
  updateRole,
}

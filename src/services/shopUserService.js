const bcrypt = require('bcryptjs')
const User = require('../models/User')
const httpError = require('../utils/httpError')
const { currentTenant, ownerKeyForUser } = require('../utils/tenantContext')
const { SHOP_ROLES } = require('../utils/shopRoles')

function serialize(user) {
  return {
    id: user._id.toString(),
    username: user.username,
    email: user.email,
    accountType: user.role,
    shopRole: user.shopRole || (user.role === 'admin' ? 'store_manager' : 'sales_associate'),
    active: user.active !== false,
    createdAt: user.createdAt,
  }
}

async function listUsers() {
  const tenant = currentTenant()
  const users = await User.find({ role: { $in: ['admin', 'staff'] } }).select('-password').sort({ createdAt: -1 }).lean()
  return users.filter((user) => ownerKeyForUser(user) === tenant.ownerKey).map(serialize)
}

async function createUser(body = {}) {
  const tenant = currentTenant()
  const username = String(body.username || '').trim()
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  const shopRole = String(body.shopRole || '')

  if (!username || !email || password.length < 8) throw httpError(400, 'Name, email, and a password of at least 8 characters are required')
  if (!SHOP_ROLES.includes(shopRole)) throw httpError(400, 'Select a valid shop role')
  if (await User.findOne({ email })) throw httpError(409, 'An account with this email already exists')

  const user = await User.create({
    username,
    email,
    password: await bcrypt.hash(password, 10),
    role: 'staff',
    shopRole,
    ownerKey: tenant.ownerKey,
    ownerEmail: tenant.ownerEmail,
    active: true,
  })
  return serialize(user)
}

async function updateUser(id, body = {}) {
  if (!/^[a-f\d]{24}$/i.test(String(id))) throw httpError(400, 'Invalid user ID')
  const tenant = currentTenant()
  const user = await User.findById(id)
  if (!user || user.role !== 'staff' || ownerKeyForUser(user) !== tenant.ownerKey) throw httpError(404, 'Shop staff account not found')

  if (body.username !== undefined) {
    const username = String(body.username).trim()
    if (!username) throw httpError(400, 'Name is required')
    user.username = username
  }
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase()
    if (!email) throw httpError(400, 'Email is required')
    const existing = await User.findOne({ email, _id: { $ne: user._id } })
    if (existing) throw httpError(409, 'An account with this email already exists')
    user.email = email
  }
  if (body.password !== undefined && String(body.password)) {
    const password = String(body.password)
    if (password.length < 8) throw httpError(400, 'Password must be at least 8 characters')
    user.password = await bcrypt.hash(password, 10)
  }
  if (body.shopRole !== undefined) {
    const shopRole = String(body.shopRole)
    if (!SHOP_ROLES.includes(shopRole)) throw httpError(400, 'Select a valid shop role')
    user.shopRole = shopRole
  }
  if (body.active !== undefined) user.active = Boolean(body.active)
  await user.save()
  return serialize(user)
}

module.exports = { listUsers, createUser, updateUser }

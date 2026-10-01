const bcrypt = require('bcryptjs')
const mongoose = require('mongoose')
const User = require('../models/User')
const Inventory = require('../models/Inventory')
const Purchase = require('../models/Purchase')
const Sale = require('../models/Sale')
const Expense = require('../models/Expense')
const Loan = require('../models/Loan')
const Setting = require('../models/Setting')
const PartnerTransfer = require('../models/PartnerTransfer')
const storeModel = require('../models/storeModel')
const CacheManager = require('../utils/cache')
const { formatCurrency } = require('../utils/formatters')
const httpError = require('../utils/httpError')
const { isSystemAdmin, normalizeRole } = require('../utils/roles')
const { ownerKeyForUser } = require('../utils/tenantContext')

async function getAdminOverview() {
  const today = new Date().toISOString().slice(0, 10)
  const isDbConnected = mongoose.connection.readyState === 1

  let users = []
  let inventory = []
  let sales = []
  let purchases = []
  let expenses = []
  let settings = []
  let movements = []
  let loans = []
  let transfers = []

  if (!isDbConnected) {
    const store = typeof storeModel.readStore === 'function' ? await storeModel.readStore() : {}
    inventory = Array.isArray(store.inventory) ? store.inventory : []
    sales = Array.isArray(store.sales) ? store.sales : []
    purchases = Array.isArray(store.purchases) ? store.purchases : []
    expenses = Array.isArray(store.expenses) ? store.expenses : []
    settings = Array.isArray(store.settings) ? store.settings : store.settings ? [store.settings] : []

    try {
      movements = await storeModel.StockMovement.find({}).sort({ createdAt: -1 }).limit(150).lean()
    } catch (error) {
      movements = []
    }

    try {
      loans = await Loan.find({}).sort({ updatedAt: -1 }).limit(150).lean()
    } catch (error) {
      loans = []
    }

    try {
      transfers = await PartnerTransfer.find({}).sort({ updatedAt: -1 }).limit(150).lean()
    } catch (error) {
      transfers = []
    }
  } else {
    ;[users, inventory, sales, purchases, expenses, settings] = await Promise.all([
      User.find({}).select('-password').sort({ createdAt: -1 }).lean(),
      Inventory.find({}).sort({ updatedAt: -1 }).limit(300).lean(),
      Sale.find({}).sort({ createdAt: -1 }).limit(150).lean(),
      Purchase.find({}).sort({ createdAt: -1 }).limit(150).lean(),
      Expense.find({}).sort({ createdAt: -1 }).limit(150).lean(),
      Setting.find({}).lean(),
    ])

    movements = await storeModel.StockMovement.find({}).sort({ createdAt: -1 }).limit(150).lean()
    loans = await Loan.find({}).sort({ updatedAt: -1 }).limit(150).lean()
    transfers = await PartnerTransfer.find({}).sort({ updatedAt: -1 }).limit(150).lean()
  }

  const salesToday = sales.filter((row) => String(row.date || row.createdAt || '').slice(0, 10) === today).length
  const purchasesToday = purchases.filter((row) => String(row.date || row.createdAt || '').slice(0, 10) === today).length
  const expensesToday = expenses.filter((row) => String(row.date || row.createdAt || '').slice(0, 10) === today).length
  const shopOwners = users.filter((user) => user.role === 'admin')
  const shopByKey = new Map(shopOwners.map((owner) => [shopKey(owner), owner]))
  const usersByShop = new Map()
  users.filter((user) => !isSystemAdmin(user.role)).forEach((user) => {
    const key = shopKey(user)
    usersByShop.set(key, (usersByShop.get(key) || 0) + 1)
  })
  const shops = shopOwners.map((owner) => ({
    ownerKey: shopKey(owner),
    name: owner.username,
    email: owner.email,
    userCount: usersByShop.get(shopKey(owner)) || 1,
    active: owner.active !== false,
  }))
  const settingsByShop = new Map(settings.map((setting) => [String(setting.ownerKey || 'legacy'), setting]))
  const getCurrency = (row) => settingsByShop.get(recordShopKey(row))?.financial?.currency || 'RWF'
  const lowStockThreshold = Number(settingsByShop.get('shop-owner')?.inventory?.lowStockThreshold ?? settings[0]?.inventory?.lowStockThreshold ?? 5)
  const lowStockCount = inventory.filter((item) => {
    if (['low', 'low stock'].includes(String(item.status || '').toLowerCase())) return Number(item.stock || 0) > 0
    const threshold = Number(item.lowStockThreshold ?? lowStockThreshold)
    const stock = Number(item.stock || 0)
    return stock > 0 && stock <= threshold
  }).length
  const outOfStockCount = inventory.filter((item) => Number(item.stock || 0) <= 0).length
  const inventoryItems = isDbConnected ? await Inventory.countDocuments({}) : inventory.length
  const openTransfers = isDbConnected ? await PartnerTransfer.countDocuments({ status: 'OPEN' }) : transfers.filter((row) => row.status === 'OPEN').length
  const openLoans = isDbConnected ? await Loan.countDocuments({ status: { $ne: 'PAID' } }) : loans.filter((row) => row.status !== 'PAID').length

  const activity = [
    ...inventory.map((row) => activityRow('Inventory item', row, 'inventory', row.supplier, `${Number(row.stock || 0)} in stock`, shopByKey)),
    ...sales.map((row) => activityRow('Sale', row, 'sales', row.customer, formatCurrency(row.value, getCurrency(row)), shopByKey)),
    ...purchases.map((row) => activityRow('Purchase', row, 'purchases', row.supplier, formatCurrency(row.value, getCurrency(row)), shopByKey)),
    ...expenses.map((row) => activityRow('Expense', row, 'expenses', row.vendor || row.category, formatCurrency(row.amount, getCurrency(row)), shopByKey)),
    ...movements.map((row) => ({
      id: String(row._id || row.id || `${row.type}-${row.reference}-${row.date}`),
      type: movementLabel(row.type),
      reference: row.reference || row.sku,
      description: `${row.item || row.sku}${row.reason ? ` · ${row.reason}` : ''}`,
      date: row.createdAt || row.date,
      status: 'Recorded',
      actor: row.user || 'System',
      section: 'stock-movements',
      shopOwnerKey: recordShopKey(row),
      shopName: shopByKey.get(recordShopKey(row))?.username || 'Unassigned shop',
    })),
    ...loans.map((row) => ({
      id: String(row._id || row.id),
      type: row.type === 'TAKEN' ? 'Loan taken' : 'Loan given',
      reference: row.id,
      description: `${row.partyName} · ${formatCurrency(row.principalAmount, getCurrency(row))}`,
      date: row.updatedAt || row.createdAt || row.startDate,
      status: row.status,
      actor: row.recordedBy || 'System',
      section: row.type === 'TAKEN' ? 'loans-taken' : 'loans-given',
      shopOwnerKey: recordShopKey(row),
      shopName: shopByKey.get(recordShopKey(row))?.username || 'Unassigned shop',
    })),
    ...transfers.map((row) => ({
      id: String(row._id || row.reference),
      type: 'Partner transfer',
      reference: row.reference,
      description: `${row.item} · ${row.partner} · ${Number(row.quantityReceived) - Number(row.quantitySold) - Number(row.quantityReturned)} remaining`,
      date: row.updatedAt || row.createdAt || row.receivedDate,
      status: row.status,
      actor: 'System',
      section: 'transfers',
      shopOwnerKey: recordShopKey(row),
      shopName: shopByKey.get(recordShopKey(row))?.username || 'Unassigned shop',
    })),
  ].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()).slice(0, 100)

  return {
    generatedAt: new Date().toISOString(),
    metrics: {
      shops: shops.length,
      users: users.length,
      activeUsers: users.filter((user) => user.active !== false).length,
      inventoryItems,
      lowStockCount,
      outOfStockCount,
      salesToday,
      purchasesToday,
      expensesToday,
      openLoans,
      openTransfers,
    },
    shops,
    activity,
  }
}

async function listUsers() {
  const users = await User.find({}).select('-password').sort({ createdAt: -1 }).lean()
  const admins = users.filter((user) => user.role === 'admin')
  const owners = new Map(admins.map((admin) => [shopKey(admin), admin]))
  return users.map((user) => {
    const ownerKey = isSystemAdmin(user.role) ? '' : shopKey(user)
    const shopOwner = owners.get(ownerKey)
    return {
      id: user._id.toString(),
      username: user.username,
      email: user.email,
      role: normalizeRole(user.role),
      active: user.active !== false,
      ownerKey,
      shopName: isSystemAdmin(user.role) ? 'Platform' : shopOwner?.username || user.ownerEmail || ownerKey,
      shopEmail: isSystemAdmin(user.role) ? '' : shopOwner?.email || user.ownerEmail || ownerKey,
      createdAt: user.createdAt,
    }
  })
}

async function createUser(body = {}) {
  const username = String(body.username || '').trim()
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  const role = String(body.role || 'staff')
  if (!username || !email || password.length < 8) throw httpError(400, 'Name, email, and a password of at least 8 characters are required')
  if (!['admin', 'staff'].includes(role)) throw httpError(400, 'New platform System Admin accounts must be provisioned separately')
  if (await User.findOne({ email })) throw httpError(409, 'An account with this email already exists')

  let ownerKey
  let ownerEmail
  if (role === 'admin') {
    ownerKey = email
    ownerEmail = email
  } else {
    ownerKey = String(body.ownerKey || '').trim()
    if (!ownerKey) throw httpError(400, 'Select a shop for this staff account')
    const requestedShopKey = ownerKey.toLowerCase()
    const shopAdmins = await User.find({ role: 'admin', active: { $ne: false } }).lean()
    const shopAdmin = shopAdmins.find((admin) => (
      shopKey(admin) === requestedShopKey
      || String(admin.email || '').toLowerCase() === requestedShopKey
    ))
    if (!shopAdmin) throw httpError(404, 'Active shop administrator not found')
    ownerKey = shopKey(shopAdmin)
    ownerEmail = shopAdmin.email
  }

  const user = await User.create({
    username,
    email,
    password: await bcrypt.hash(password, 10),
    role,
    ownerKey,
    ownerEmail,
    active: true,
  })
  CacheManager.clear()
  return { id: user._id.toString(), username: user.username, email: user.email, role: user.role, active: user.active, ownerKey: user.ownerKey, ownerEmail: user.ownerEmail }
}

async function updateUser(id, body = {}, actingUserId) {
  if (!/^[a-f\d]{24}$/i.test(String(id))) throw httpError(400, 'Invalid user ID')
  const user = await User.findById(id)
  if (!user) throw httpError(404, 'User not found')
  if (isSystemAdmin(user.role)) throw httpError(403, 'Platform System Admin accounts cannot be changed here')
  if (String(user._id) === String(actingUserId)) throw httpError(400, 'You cannot change your own shop account here')

  const username = body.username === undefined ? user.username : String(body.username).trim()
  const email = body.email === undefined ? user.email : String(body.email).trim().toLowerCase()
  const nextRole = body.role === undefined ? user.role : String(body.role)
  const nextActive = body.active === undefined ? user.active !== false : Boolean(body.active)
  if (!username || !email) throw httpError(400, 'Name and email are required')
  if (!['admin', 'staff'].includes(nextRole)) throw httpError(400, 'User role must be admin or staff')
  if (email !== user.email && await User.findOne({ email, _id: { $ne: user._id } })) {
    throw httpError(409, 'An account with this email already exists')
  }
  if (user.role === 'admin' && (nextRole !== 'admin' || !nextActive)) {
    const key = shopKey(user)
    const activeAdmins = await User.countDocuments({ role: 'admin', active: { $ne: false }, $or: [{ ownerKey: key }, { email: key }] })
    if (activeAdmins <= 1) throw httpError(400, 'A shop must keep at least one active administrator')
  }
  let ownerKey = user.ownerKey
  let ownerEmail = user.ownerEmail
  if (nextRole === 'admin') {
    ownerKey = user.role === 'admin' && shopKey(user) === 'legacy' ? 'legacy' : email
    ownerEmail = email
  } else if (body.ownerKey !== undefined) {
    const requestedShopKey = String(body.ownerKey || '').trim().toLowerCase()
    if (!requestedShopKey) throw httpError(400, 'Select a shop for this staff account')
    const shopAdmins = await User.find({ role: 'admin', active: { $ne: false } }).lean()
    const shopAdmin = shopAdmins.find((admin) => shopKey(admin) === requestedShopKey || String(admin.email || '').toLowerCase() === requestedShopKey)
    if (!shopAdmin) throw httpError(404, 'Active shop administrator not found')
    ownerKey = shopKey(shopAdmin)
    ownerEmail = shopAdmin.email
  }
  if (body.password !== undefined && String(body.password)) {
    const password = String(body.password)
    if (password.length < 8) throw httpError(400, 'Password must be at least 8 characters')
    user.password = await bcrypt.hash(password, 10)
  }
  user.username = username
  user.email = email
  user.role = nextRole
  user.ownerKey = ownerKey
  user.ownerEmail = ownerEmail
  user.active = nextActive
  await user.save()
  CacheManager.clear()
  return { id: user._id.toString(), username: user.username, email: user.email, role: user.role, active: user.active, ownerKey: user.ownerKey }
}

function activityRow(type, row, section, actor, amount, shopByKey) {
  const ownerKey = recordShopKey(row)
  return {
    id: String(row._id || row.id || `${type}-${row.date}`),
    type,
    reference: row.id || row.reference || '-',
    description: row.item || row.description || row.category || type,
    date: row.updatedAt || row.createdAt || row.date,
    status: row.status || 'Recorded',
    actor: actor || 'Not recorded',
    amount,
    section,
    shopOwnerKey: ownerKey,
    shopName: shopByKey.get(ownerKey)?.username || 'Unassigned shop',
  }
}

function recordShopKey(row) {
  return String(row.ownerKey || row.ownerEmail || 'legacy').toLowerCase()
}

function shopKey(user) {
  return ownerKeyForUser(user).toLowerCase()
}

function movementLabel(type) {
  return String(type || 'Stock movement').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function isToday(value) {
  const date = new Date(value)
  const today = new Date()
  return !Number.isNaN(date.getTime())
    && date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate()
}

module.exports = { getAdminOverview, listUsers, createUser, updateUser }

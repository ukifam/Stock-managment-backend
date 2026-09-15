const seedData = require('../data/seedData')
const Inventory = require('./Inventory')
const Purchase = require('./Purchase')
const Sale = require('./Sale')
const Expense = require('./Expense')
const Setting = require('./Setting')
const Venue = require('./Venue')
const StockMovement = require('./StockMovement')
const User = require('./User')
const Loan = require('./Loan')
const bcrypt = require('bcryptjs')
const { LEGACY_OWNER_EMAIL, LEGACY_OWNER_KEY, currentTenant, scopedQuery, tenantFilter, withTenantFields } = require('../utils/tenantContext')

let legacyIndexMigration

async function ensureStore() {
  await ensureTenantIndexes()
  const inventoryCount = await Inventory.countDocuments()
  const purchaseCount = await Purchase.countDocuments()
  const saleCount = await Sale.countDocuments()
  const expenseCount = await Expense.countDocuments()
  const settingsCount = await Setting.countDocuments()
  const venueCount = await Venue.countDocuments()
  const stockMovementCount = await StockMovement.countDocuments()
  const userCount = await User.countDocuments()

  if (!inventoryCount) await Inventory.insertMany(seedData.inventory.map(markLegacy))
  if (!purchaseCount) await Purchase.insertMany(seedData.purchases.map(markLegacy))
  if (!saleCount) await Sale.insertMany(seedData.sales.map(markLegacy))
  if (!expenseCount) {
    // no default expenses; keep empty by default
  }
  if (!settingsCount) await Setting.create(markLegacy(seedData.settings))
  if (!venueCount) await Venue.insertMany(seedData.venues.map(markLegacy))
  if (!stockMovementCount && seedData.stockMovements) await StockMovement.insertMany(seedData.stockMovements.map(markLegacy))
  if (!userCount) {
    const defaultPassword = await bcrypt.hash('admin123', 10)
    await User.create({
      username: 'Admin Manager',
      email: 'admin@triltd.com',
      password: defaultPassword,
      role: 'admin',
    })
  }
}

async function readStore() {
  await ensureStore()
  const filter = tenantFilter()
  const settings = await Setting.findOne(filter).lean()

  const [inventory, purchases, sales, expenses] = await Promise.all([
    Inventory.find(filter).sort({ createdAt: -1 }).lean(),
    Purchase.find(filter).sort({ createdAt: -1 }).lean(),
    Sale.find(filter).sort({ createdAt: -1 }).lean(),
    Expense.find(filter).sort({ createdAt: -1 }).lean(),
  ])

  return {
    inventory,
    purchases,
    sales,
    expenses,
    settings: settings || defaultSettingsForTenant(),
  }
}

/**
 * Optimized write with upsert instead of delete + insert
 * This significantly reduces write time and database load
 */
async function writeStore(store) {
  try {
    const tenant = currentTenant()
    const scoped = (item) => withTenantFields(item)
    // Use bulkWrite for atomic operations
    if (store.inventory?.length) {
      const inventoryOps = store.inventory.map((item) => ({
        updateOne: {
          filter: item._id ? { _id: item._id } : { ownerKey: tenant.ownerKey, sku: item.sku },
          update: { $set: scoped(item) },
          upsert: true,
        },
      }))
      if (inventoryOps.length > 0) {
        await Inventory.bulkWrite(inventoryOps)
      }
    }

    if (store.purchases?.length) {
      const purchaseOps = store.purchases.map((item) => ({
        updateOne: {
          filter: item._id ? { _id: item._id } : { ownerKey: tenant.ownerKey, id: item.id },
          update: { $set: scoped(item) },
          upsert: true,
        },
      }))
      if (purchaseOps.length > 0) {
        await Purchase.bulkWrite(purchaseOps)
      }
    }

    if (store.sales?.length) {
      const saleOps = store.sales.map((item) => ({
        updateOne: {
          filter: item._id ? { _id: item._id } : { ownerKey: tenant.ownerKey, id: item.id },
          update: { $set: scoped(item) },
          upsert: true,
        },
      }))
      if (saleOps.length > 0) {
        await Sale.bulkWrite(saleOps)
      }
    }

    if (store.expenses?.length) {
      const expenseOps = store.expenses.map((item) => ({
        updateOne: {
          filter: item._id ? { _id: item._id } : { ownerKey: tenant.ownerKey, id: item.id },
          update: { $set: scoped(item) },
          upsert: true,
        },
      }))
      if (expenseOps.length > 0) {
        await Expense.bulkWrite(expenseOps)
      }
    }

    if (store.settings) {
      const existingSettings = await Setting.findOne({ ownerKey: tenant.ownerKey })
      const settingsId = store.settings._id || existingSettings?._id
      if (settingsId) {
        await Setting.updateOne({ _id: settingsId }, { $set: scoped(store.settings) })
      } else {
        await Setting.create(scoped(store.settings))
      }
    }
  } catch (error) {
    console.error('Error in writeStore:', error)
    throw error
  }
}

function markLegacy(record) {
  return {
    ...record,
    ownerKey: LEGACY_OWNER_KEY,
    ownerEmail: LEGACY_OWNER_EMAIL,
  }
}

function defaultSettingsForTenant() {
  const tenant = currentTenant()
  return withTenantFields({
    ...seedData.settings,
    profile: {
      ...seedData.settings.profile,
      email: tenant.ownerEmail,
      displayName: tenant.ownerKey === LEGACY_OWNER_KEY ? seedData.settings.profile.displayName : '',
    },
  })
}

async function ensureTenantIndexes() {
  if (!legacyIndexMigration) {
    legacyIndexMigration = Promise.all([
      dropIndexIfExists(Inventory, 'sku_1'),
      dropIndexIfExists(Purchase, 'id_1'),
      dropIndexIfExists(Sale, 'id_1'),
      dropIndexIfExists(Loan, 'id_1'),
      dropIndexIfExists(Venue, 'name_1'),
      dropIndexIfExists(Venue, 'code_1'),
    ])
  }

  await legacyIndexMigration
}

async function dropIndexIfExists(model, indexName) {
  try {
    const indexes = await model.collection.indexes()
    if (indexes.some((index) => index.name === indexName && index.unique)) {
      await model.collection.dropIndex(indexName)
    }
  } catch (error) {
    if (error.codeName !== 'IndexNotFound' && error.code !== 27) {
      throw error
    }
  }
}

module.exports = {
  ensureStore,
  readStore,
  writeStore,
  Inventory,
  Purchase,
  Sale,
  Setting,
  Venue,
  StockMovement,
  scopedQuery,
  tenantFilter,
  withTenantFields,
}

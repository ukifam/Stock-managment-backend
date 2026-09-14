const seedData = require('../data/seedData')
const Inventory = require('./Inventory')
const Purchase = require('./Purchase')
const Sale = require('./Sale')
const Expense = require('./Expense')
const Setting = require('./Setting')
const Venue = require('./Venue')
const StockMovement = require('./StockMovement')

async function ensureStore() {
  const inventoryCount = await Inventory.countDocuments()
  const purchaseCount = await Purchase.countDocuments()
  const saleCount = await Sale.countDocuments()
  const expenseCount = await Expense.countDocuments()
  const settingsCount = await Setting.countDocuments()
  const venueCount = await Venue.countDocuments()
  const stockMovementCount = await StockMovement.countDocuments()

  if (!inventoryCount) await Inventory.insertMany(seedData.inventory)
  if (!purchaseCount) await Purchase.insertMany(seedData.purchases)
  if (!saleCount) await Sale.insertMany(seedData.sales)
  if (!expenseCount) {
    // no default expenses; keep empty by default
  }
  if (!settingsCount) await Setting.create(seedData.settings)
  if (!venueCount) await Venue.insertMany(seedData.venues)
  if (!stockMovementCount && seedData.stockMovements) await StockMovement.insertMany(seedData.stockMovements)
}

async function readStore() {
  await ensureStore()

  const [inventory, purchases, sales, expenses, settings] = await Promise.all([
    Inventory.find().sort({ createdAt: -1 }).lean(),
    Purchase.find().sort({ createdAt: -1 }).lean(),
    Sale.find().sort({ createdAt: -1 }).lean(),
    Expense.find().sort({ createdAt: -1 }).lean(),
    Setting.findOne().lean(),
  ])

  return {
    inventory,
    purchases,
    sales,
    expenses,
    settings: settings || seedData.settings,
  }
}

/**
 * Optimized write with upsert instead of delete + insert
 * This significantly reduces write time and database load
 */
async function writeStore(store) {
  try {
    // Use bulkWrite for atomic operations
    if (store.inventory?.length) {
      const inventoryOps = store.inventory.map((item) => ({
        updateOne: {
          filter: { sku: item.sku },
          update: { $set: item },
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
          filter: { id: item.id },
          update: { $set: item },
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
          filter: { id: item.id },
          update: { $set: item },
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
          filter: { id: item.id },
          update: { $set: item },
          upsert: true,
        },
      }))
      if (expenseOps.length > 0) {
        await Expense.bulkWrite(expenseOps)
      }
    }

    if (store.settings) {
      const settingsId = (await Setting.findOne()) ? (await Setting.findOne())._id : null
      if (settingsId) {
        await Setting.updateOne({ _id: settingsId }, { $set: store.settings })
      } else {
        await Setting.create(store.settings)
      }
    }
  } catch (error) {
    console.error('Error in writeStore:', error)
    throw error
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
}

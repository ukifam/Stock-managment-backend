const seedData = require('../data/seedData')
const Inventory = require('./Inventory')
const Purchase = require('./Purchase')
const Sale = require('./Sale')
const Setting = require('./Setting')

async function ensureStore() {
  const inventoryCount = await Inventory.countDocuments()
  const purchaseCount = await Purchase.countDocuments()
  const saleCount = await Sale.countDocuments()
  const settingsCount = await Setting.countDocuments()

  if (!inventoryCount) await Inventory.insertMany(seedData.inventory)
  if (!purchaseCount) await Purchase.insertMany(seedData.purchases)
  if (!saleCount) await Sale.insertMany(seedData.sales)
  if (!settingsCount) await Setting.create(seedData.settings)
}

async function readStore() {
  await ensureStore()

  const [inventory, purchases, sales, settings] = await Promise.all([
    Inventory.find().sort({ createdAt: -1 }).lean(),
    Purchase.find().sort({ createdAt: -1 }).lean(),
    Sale.find().sort({ createdAt: -1 }).lean(),
    Setting.findOne().lean(),
  ])

  return {
    inventory,
    purchases,
    sales,
    settings: settings || seedData.settings,
  }
}

async function writeStore(store) {
  await Promise.all([
    Inventory.deleteMany({}),
    Purchase.deleteMany({}),
    Sale.deleteMany({}),
    Setting.deleteMany({}),
  ])

  await Promise.all([
    store.inventory?.length ? Inventory.insertMany(store.inventory) : Promise.resolve(),
    store.purchases?.length ? Purchase.insertMany(store.purchases) : Promise.resolve(),
    store.sales?.length ? Sale.insertMany(store.sales) : Promise.resolve(),
    Setting.create(store.settings || seedData.settings),
  ])
}

module.exports = {
  ensureStore,
  readStore,
  writeStore,
  Inventory,
  Purchase,
  Sale,
  Setting,
}

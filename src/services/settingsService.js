const storeModel = require('../models/storeModel')
const httpError = require('../utils/httpError')

const CURRENCIES = ['RWF', 'USD', 'EUR', 'GBP', 'KES', 'UGX', 'TZS', 'BIF', 'CDF']

async function getSettings() {
  const store = await storeModel.readStore()
  return withDefaults(store.settings)
}

async function updateSettings(body = {}) {
  const store = await storeModel.readStore()
  const current = withDefaults(store.settings)
  const profile = pick(body.profile, ['displayName'])
  const system = pick(body.system, ['darkMode'])
  const inventory = pick(body.inventory, ['lowStockThreshold'])
  const financial = pick(body.financial, ['currency'])

  if (inventory.lowStockThreshold !== undefined) {
    const threshold = Number(inventory.lowStockThreshold)
    if (!Number.isFinite(threshold) || threshold < 0) throw httpError(400, 'Low stock threshold must be zero or more')
    inventory.lowStockThreshold = threshold
  }
  if (financial.currency !== undefined) {
    financial.currency = String(financial.currency).trim().toUpperCase()
    if (!CURRENCIES.includes(financial.currency)) throw httpError(400, 'Choose a supported currency')
  }
  if (profile.displayName !== undefined) profile.displayName = String(profile.displayName).trim()
  if (system.darkMode !== undefined) system.darkMode = Boolean(system.darkMode)

  store.settings = {
    ...current,
    profile: { ...current.profile, ...profile },
    system: { ...current.system, ...system },
    inventory: { ...current.inventory, ...inventory },
    financial: { ...current.financial, ...financial },
  }
  await storeModel.writeStore(store)
  return withDefaults(store.settings)
}

function withDefaults(settings = {}) {
  return {
    ...(settings._id ? { _id: settings._id } : {}),
    profile: { displayName: '', email: '', ...settings.profile },
    system: { darkMode: settings.system?.darkMode ?? true },
    inventory: { lowStockThreshold: settings.inventory?.lowStockThreshold ?? 25 },
    financial: { currency: 'RWF', ...settings.financial },
  }
}

function pick(source, keys) {
  if (!source || typeof source !== 'object') return {}
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]))
}

module.exports = {
  getSettings,
  updateSettings,
}

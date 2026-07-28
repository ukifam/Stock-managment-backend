const storeModel = require('../models/storeModel')

async function getSettings() {
  const store = await storeModel.readStore()
  return withDefaults(store.settings)
}

async function updateSettings(body) {
  const store = await storeModel.readStore()
  const current = withDefaults(store.settings)
  store.settings = {
    ...current,
    ...body,
    profile: { ...current.profile, ...body.profile },
    system: { ...current.system, ...body.system },
    inventory: { ...current.inventory, ...body.inventory },
    financial: { ...current.financial, ...body.financial },
  }
  await storeModel.writeStore(store)
  return withDefaults(store.settings)
}

function withDefaults(settings = {}) {
  return {
    ...settings,
    profile: { displayName: '', email: '', ...settings.profile },
    system: { darkMode: true, biometricLogin: false, telemetryReports: true, quantumSync: true, ...settings.system },
    inventory: { lowStockThreshold: 25, autoBackupFrequency: 'Daily at 00:00', externalDatabase: '', ...settings.inventory },
    financial: { currency: 'RWF', ...settings.financial },
    hardware: settings.hardware || [],
  }
}

module.exports = {
  getSettings,
  updateSettings,
}

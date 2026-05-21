const storeModel = require('../models/storeModel')

async function getSettings() {
  const store = await storeModel.readStore()
  return store.settings
}

async function updateSettings(body) {
  const store = await storeModel.readStore()
  store.settings = {
    ...store.settings,
    ...body,
    profile: { ...store.settings.profile, ...body.profile },
    system: { ...store.settings.system, ...body.system },
    inventory: { ...store.settings.inventory, ...body.inventory },
  }
  await storeModel.writeStore(store)
  return store.settings
}

module.exports = {
  getSettings,
  updateSettings,
}

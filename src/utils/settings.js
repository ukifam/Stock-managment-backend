function currencyFromSettings(settings) {
  return settings?.financial?.currency || 'RWF'
}

module.exports = {
  currencyFromSettings,
}

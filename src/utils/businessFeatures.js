const PROCESSING_TEMPLATES = new Set([
  'agro_processor',
  'bakery',
  'cafe',
  'cosmetics',
  'furniture_workshop',
  'juice_producer',
  'maize_mill',
  'restaurant',
  'soap_manufacturer',
])

function businessFeatures(template, processingEnabled) {
  const templateDefault = PROCESSING_TEMPLATES.has(String(template || '').trim().toLowerCase())
  return { processing: typeof processingEnabled === 'boolean' ? processingEnabled : templateDefault }
}

module.exports = { PROCESSING_TEMPLATES, businessFeatures }

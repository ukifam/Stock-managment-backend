function parseMoney(value, fallback = 0) {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return fallback
  const parsed = Number(value.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseQuantity(value, fallback = 1) {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return fallback
  const parsed = Number(value.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

module.exports = {
  parseMoney,
  parseQuantity,
}

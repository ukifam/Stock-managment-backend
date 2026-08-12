function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'item'
}

function toDateValue(dateLike) {
  if (!dateLike) return new Date()
  if (dateLike instanceof Date) return dateLike
  if (typeof dateLike === 'number') return new Date(dateLike)
  if (typeof dateLike === 'string') {
    const trimmed = dateLike.trim()
    const legacyMatch = trimmed.match(/(\d{10,13})/)
    if (legacyMatch) return new Date(Number(legacyMatch[1]))
    const parsed = new Date(trimmed)
    if (!Number.isNaN(parsed.getTime())) return parsed
    return new Date()
  }
  return new Date()
}

function formatDocumentId(prefix, row = {}, fallbackDate = new Date()) {
  const dateSource = toDateValue(row?.date || fallbackDate)
  const year = dateSource.getFullYear()
  const month = String(dateSource.getMonth() + 1).padStart(2, '0')
  const day = String(dateSource.getDate()).padStart(2, '0')
  const hours = String(dateSource.getHours()).padStart(2, '0')
  const minutes = String(dateSource.getMinutes()).padStart(2, '0')
  const itemName = row?.item || row?.supplier || row?.customer || row?.name || 'item'
  const slug = slugify(itemName)
  return `${prefix}-${slug}-${year}-${month}-${day}-${hours}:${minutes}`
}

function normalizeDocumentId(prefix, row = {}, existingId) {
  const rawId = String(existingId || '').trim()
  if (!rawId) return formatDocumentId(prefix, row)
  if (rawId.startsWith(prefix.toUpperCase() + '-') || rawId.startsWith(prefix.toLowerCase() + '-')) {
    const alreadyReadable = rawId.match(new RegExp(`^${prefix}-[a-z0-9-]+-\d{4}-\d{2}-\d{2}-\d{2}:\d{2}$`, 'i'))
    if (alreadyReadable) return rawId
  }
  return formatDocumentId(prefix, row, rawId)
}

module.exports = {
  formatDocumentId,
  normalizeDocumentId,
}

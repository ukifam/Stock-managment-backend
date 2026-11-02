function normalizeText(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// Exact SKU wins over exact name, which wins over a partial name match, so
// "Milk" never resolves to "Milk Chocolate" when a "Milk" row exists.
function findInventoryItem(inventory, entry) {
  const rows = Array.isArray(inventory) ? inventory : []
  const sku = normalizeText(entry?.sku)
  const item = normalizeText(entry?.item)

  if (sku) {
    const bySku = rows.find((row) => normalizeText(row.sku) === sku)
    if (bySku) return bySku
  }
  if (!item) return undefined

  const byName = rows.find((row) => normalizeText(row.item) === item)
  if (byName) return byName

  const partial = rows.filter((row) => {
    const rowItem = normalizeText(row.item)
    return rowItem && (rowItem.includes(item) || item.includes(rowItem))
  })
  return partial.length === 1 ? partial[0] : undefined
}

function inventoryStatus(stock, item = {}) {
  const count = Number(stock || 0)
  if (count <= 0) return 'Out of Stock'
  const reorder = Number(item.reorderLevel || item.minimumStock || 0)
  const capacity = Number(item.maximumStock || item.capacity || 0)
  if ((reorder > 0 && count <= reorder) || (!reorder && capacity > 0 && count <= capacity * 0.2)) return 'Low'
  return 'Active'
}

function isSellableStatus(status) {
  return !['inactive', 'archived', 'discontinued'].includes(String(status || '').trim().toLowerCase())
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

module.exports = { escapeRegex, findInventoryItem, inventoryStatus, isSellableStatus, normalizeText }

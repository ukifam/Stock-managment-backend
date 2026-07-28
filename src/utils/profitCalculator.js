function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
}

function itemMatches(left, right) {
  if (!left || !right) return false
  if (left === right) return true
  return left.includes(right) || right.includes(left)
}

function findInventoryMatch(inventory, entry) {
  const sku = normalizeText(entry.sku)
  const item = normalizeText(entry.item)

  return inventory.find((row) => {
    const rowSku = normalizeText(row.sku)
    const rowItem = normalizeText(row.item)
    return (sku && rowSku === sku) || itemMatches(rowItem, item)
  })
}

function addCostEntry(totals, key, quantity, unitPrice) {
  if (!key || quantity <= 0) return
  const entry = totals.get(key) || { units: 0, totalCost: 0 }
  entry.units += quantity
  entry.totalCost += quantity * unitPrice
  totals.set(key, entry)
}

function buildAverageUnitCostIndex(purchases, inventory = []) {
  const totals = new Map()

  purchases.forEach((purchase) => {
    const qty = Number(purchase.quantity || 0)
    const unitPrice = Number(purchase.unitPrice || 0)
    if (qty <= 0) return

    const sku = normalizeText(purchase.sku)
    const item = normalizeText(purchase.item)
    if (sku) addCostEntry(totals, sku, qty, unitPrice)
    if (item) addCostEntry(totals, item, qty, unitPrice)

    const inv = findInventoryMatch(inventory, purchase)
    if (inv) {
      const invSku = normalizeText(inv.sku)
      const invItem = normalizeText(inv.item)
      if (invSku) addCostEntry(totals, invSku, qty, unitPrice)
      if (invItem) addCostEntry(totals, invItem, qty, unitPrice)
    }
  })

  const averages = new Map()
  totals.forEach((entry, key) => {
    averages.set(key, entry.units > 0 ? entry.totalCost / entry.units : 0)
  })
  return averages
}

function resolveUnitCost(sale, costIndex, inventory = []) {
  const candidates = []
  const sku = normalizeText(sale.sku)
  const item = normalizeText(sale.item)

  if (sku) candidates.push(sku)
  if (item) candidates.push(item)

  const inv = findInventoryMatch(inventory, sale)
  if (inv) {
    candidates.push(normalizeText(inv.sku))
    candidates.push(normalizeText(inv.item))
  }

  for (const key of candidates) {
    const cost = costIndex.get(key)
    if (cost !== undefined && cost > 0) return cost
  }

  if (item) {
    for (const [key, cost] of costIndex.entries()) {
      if (cost > 0 && itemMatches(key, item)) return cost
    }
  }

  return 0
}

function computeMatchedGrossProfit(sales, purchaseCostIndex, inventory = [], purchases = []) {
  let revenue = 0
  let costOfGoodsSold = 0
  const purchaseLots = buildPurchaseLots(purchases)

  sales.forEach((sale) => {
    const qty = Number(sale.quantity || 1)
    const saleRevenue = Number(sale.value || 0)
    const unitCost = calculateSaleCost(sale, purchaseLots, purchaseCostIndex, inventory)
    revenue += saleRevenue
    costOfGoodsSold += unitCost
  })

  return {
    revenue,
    costOfGoodsSold,
    grossProfit: revenue - costOfGoodsSold,
  }
}

function buildPurchaseLots(purchases = []) {
  const lots = purchases
    .map((purchase) => ({
      date: parseDateValue(purchase.date),
      sku: normalizeText(purchase.sku),
      item: normalizeText(purchase.item),
      quantity: Number(purchase.quantity || 0),
      unitPrice: Number(purchase.unitPrice || 0),
      remaining: Number(purchase.quantity || 0),
    }))
    .filter((lot) => lot.quantity > 0 && Number.isFinite(lot.unitPrice))
    .sort((left, right) => left.date - right.date)

  return lots
}

function calculateSaleCost(sale, purchaseLots, purchaseCostIndex, inventory = []) {
  const saleQuantity = Number(sale.quantity || 1)
  const saleDate = parseDateValue(sale.date)
  let remainingQuantity = saleQuantity
  let totalCost = 0

  purchaseLots
    .filter((lot) => lot.date <= saleDate)
    .forEach((lot) => {
      if (remainingQuantity <= 0 || lot.remaining <= 0) return
      if (!lotMatchesSale(lot, sale, inventory)) return

      const consumed = Math.min(lot.remaining, remainingQuantity)
      totalCost += consumed * lot.unitPrice
      lot.remaining -= consumed
      remainingQuantity -= consumed
    })

  if (remainingQuantity > 0) {
    const fallbackCost = resolveUnitCost(sale, purchaseCostIndex, inventory)
    totalCost += remainingQuantity * fallbackCost
  }

  return Math.max(0, totalCost)
}

function lotMatchesSale(lot, sale, inventory = []) {
  const saleKeys = [normalizeText(sale.sku), normalizeText(sale.item)]
  const inventoryMatch = findInventoryMatch(inventory, sale)
  if (inventoryMatch) {
    saleKeys.push(normalizeText(inventoryMatch.sku))
    saleKeys.push(normalizeText(inventoryMatch.item))
  }

  const lotKeys = [lot.sku, lot.item].filter(Boolean)
  return saleKeys.some((saleKey) => saleKey && lotKeys.some((lotKey) => lotKey && (lotKey === saleKey || itemMatches(lotKey, saleKey))))
}

function parseDateValue(value) {
  const parsed = new Date(`${value}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed
}

function productKey(row) {
  const sku = String(row.sku || '').trim().toLowerCase()
  if (sku) return sku
  return normalizeText(row.item)
}

module.exports = {
  productKey,
  buildAverageUnitCostIndex,
  computeMatchedGrossProfit,
}

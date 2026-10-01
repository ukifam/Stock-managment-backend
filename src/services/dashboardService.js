const storeModel = require('../models/storeModel')
const { formatCurrency } = require('../utils/formatters')
const { currencyFromSettings } = require('../utils/settings')
const CacheManager = require('../utils/cache')

/**
 * Get dashboard with caching for improved performance
 * Dashboard data is cached for 30 seconds
 */
async function getDashboard(filters = {}) {
  // Check cache first - dashboard rarely changes
  const { from, to, category = '', stockStatus = 'all' } = filters
  const cacheKey = `dashboard:${from || ''}:${to || ''}:${category}:${stockStatus}`
  const cached = CacheManager.get(cacheKey)
  if (cached) {
    return cached
  }

  const store = await storeModel.readStore()
  const sales = store.sales.filter((sale) => isWithinDateRange(sale.date, from, to))
  const purchases = store.purchases.filter((purchase) => isWithinDateRange(purchase.date, from, to))
  const inventory = filterInventory(store.inventory, store.settings, category, stockStatus)
  const summary = totals(store, sales, purchases, inventory)
  const currency = currencyFromSettings(store.settings)

  const result = {
    categories: [...new Set(store.inventory.map((item) => item.category).filter(Boolean))].sort(),
    metrics: [
      { label: 'Total Products', value: summary.totalProducts.toLocaleString('en-US'), delta: `${summary.lowStockCount} low stock` },
      { label: 'Total Sales', value: formatCurrency(summary.totalSales, currency), delta: `${sales.length} orders` },
      { label: 'Total Purchases', value: formatCurrency(summary.totalPurchases, currency), delta: `${purchases.length} orders` },
      { label: 'Available Stock', value: `${summary.availableStock.toFixed(1)}%`, delta: `${summary.stockAvailable} units` },
    ],
    salesBars: rangeBars(sales, from, to),
    salesLabels: rangeLabels(sales, from, to),
    lowStock: lowStockAlerts({ ...store, inventory }),
    catalog: catalogItems({ ...store, inventory }),
  }

  // Cache for 30 seconds (shorter TTL since dashboard updates frequently)
  CacheManager.set(cacheKey, result, 30000)
  return result
}

function totals(store, sales, purchases, inventory) {
  const stockCapacity = inventory.reduce((sum, item) => sum + Number(item.capacity || 0), 0)
  const stockAvailable = inventory.reduce((sum, item) => sum + Number(item.stock || 0), 0)
  const salesValue = sales.reduce((sum, sale) => sum + Number(sale.value || 0), 0)
  const purchaseValue = purchases.reduce(
    (sum, purchase) => sum + Number(purchase.quantity || 0) * Number(purchase.unitPrice || 0),
    0,
  )
  const lowStockCount = inventory.filter((item) => Number(item.stock || 0) <= Number(store.settings.inventory.lowStockThreshold || 25)).length

  return {
    totalProducts: inventory.length,
    totalSales: salesValue,
    totalPurchases: purchaseValue,
    availableStock: stockCapacity ? (stockAvailable / stockCapacity) * 100 : 0,
    stockAvailable,
    lowStockCount,
  }
}

function lowStockAlerts(store) {
  const threshold = Number(store.settings.inventory.lowStockThreshold || 25)
  return store.inventory
    .filter((item) => item.stock <= threshold)
    .sort((a, b) => a.stock - b.stock)
    .map((item) => ({
      name: item.item,
      sku: item.sku,
      status: item.stock === 0 ? 'Out of Stock' : `${item.stock} left`,
      action: item.stock === 0 ? 'Urgent Restock' : 'Quick Reorder',
    }))
}

function filterInventory(inventory, settings, category, stockStatus) {
  const threshold = Number(settings.inventory.lowStockThreshold || 25)
  return inventory.filter((item) => {
    if (category && item.category !== category) return false
    const stock = Number(item.stock || 0)
    if (stockStatus === 'out' && stock !== 0) return false
    if (stockStatus === 'low' && (stock === 0 || stock > threshold)) return false
    if (stockStatus === 'available' && stock <= threshold) return false
    return true
  })
}

function catalogItems(store) {
  return [...store.inventory]
    .sort((a, b) => new Date(`${b.date}T12:00:00`) - new Date(`${a.date}T12:00:00`))
    .slice(0, 4)
    .map((item) => ({
    sku: item.sku,
    name: item.item,
    type: item.category,
    price: formatCurrency(item.price, currencyFromSettings(store.settings)),
    visual: catalogVisual(item.category),
  }))
}

function isWithinDateRange(value, from, to) {
  const date = new Date(`${String(value || '').slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return false
  if (from && date < new Date(`${from}T00:00:00`)) return false
  if (to && date > new Date(`${to}T23:59:59.999`)) return false
  return true
}

function rangeBars(sales, from, to) {
  const buckets = Array.from({ length: 12 }, () => 0)
  const { start, end } = chartRange(sales, from, to)
  const duration = Math.max(end.getTime() - start.getTime(), 1)
  sales.forEach((sale) => {
    const date = new Date(`${String(sale.date || '').slice(0, 10)}T12:00:00`)
    const bucket = Math.min(11, Math.max(0, Math.floor(((date.getTime() - start.getTime()) / duration) * 12)))
    buckets[bucket] += Number(sale.value || 0)
  })

  return scaleBars(buckets)
}

function rangeLabels(sales, from, to) {
  const { start, end } = chartRange(sales, from, to)
  const duration = Math.max(end.getTime() - start.getTime(), 1)
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(start.getTime() + (duration * index * 2) / 12)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  })
}

function chartRange(sales, from, to) {
  const dates = sales.map((sale) => new Date(`${String(sale.date || '').slice(0, 10)}T12:00:00`))
    .filter((date) => !Number.isNaN(date.getTime()))
  const end = to ? new Date(`${to}T12:00:00`) : dates.length ? new Date(Math.max(...dates)) : new Date()
  const start = from
    ? new Date(`${from}T12:00:00`)
    : dates.length
      ? new Date(Math.min(...dates))
      : new Date(end.getFullYear() - 1, end.getMonth(), end.getDate())
  return { start, end }
}

function scaleBars(values) {
  const max = Math.max(...values, 0)
  if (!max) return values.map(() => 0)
  return values.map((value) => Math.max(8, Math.round((value / max) * 100)))
}

function catalogVisual(category = '') {
  const normalized = category.toLowerCase()
  if (normalized.includes('display') || normalized.includes('monitor')) return 'monitor'
  if (normalized.includes('peripheral')) return 'keyboard'
  if (normalized.includes('gaming')) return 'console'
  return 'laptop'
}

module.exports = {
  getDashboard,
}

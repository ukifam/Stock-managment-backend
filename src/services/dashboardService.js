const storeModel = require('../models/storeModel')
const { formatCurrency } = require('../utils/formatters')
const { currencyFromSettings } = require('../utils/settings')
const CacheManager = require('../utils/cache')

/**
 * Get dashboard with caching for improved performance
 * Dashboard data is cached for 30 seconds
 */
async function getDashboard() {
  // Check cache first - dashboard rarely changes
  const cacheKey = 'dashboard:main'
  const cached = CacheManager.get(cacheKey)
  if (cached) {
    return cached
  }

  const store = await storeModel.readStore()
  const summary = totals(store)
  const todaySales = salesForDate(store.sales, new Date())
  const currency = currencyFromSettings(store.settings)

  const result = {
    metrics: [
      { label: 'Total Products', value: summary.totalProducts.toLocaleString('en-US'), delta: `${summary.lowStockCount} low stock` },
      { label: 'Total Sales', value: formatCurrency(summary.totalSales, currency), delta: `${store.sales.length} orders` },
      { label: 'Total Purchases', value: formatCurrency(summary.totalPurchases, currency), delta: `${store.purchases.length} orders` },
      { label: 'Available Stock', value: `${summary.availableStock.toFixed(1)}%`, delta: `${summary.stockAvailable} units` },
    ],
    salesBars: hourlyBars(todaySales),
    lowStock: lowStockAlerts(store),
    catalog: catalogItems(store),
  }

  // Cache for 30 seconds (shorter TTL since dashboard updates frequently)
  CacheManager.set(cacheKey, result, 30000)
  return result
}

function totals(store) {
  const stockCapacity = store.inventory.reduce((sum, item) => sum + Number(item.capacity || 0), 0)
  const stockAvailable = store.inventory.reduce((sum, item) => sum + Number(item.stock || 0), 0)
  const salesValue = store.sales.reduce((sum, sale) => sum + Number(sale.value || 0), 0)
  const purchaseValue = store.purchases.reduce(
    (sum, purchase) => sum + Number(purchase.quantity || 0) * Number(purchase.unitPrice || 0),
    0,
  )
  const lowStockCount = store.inventory.filter((item) => Number(item.stock || 0) <= Number(store.settings.inventory.lowStockThreshold || 25)).length

  return {
    totalProducts: store.inventory.length,
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

function salesForDate(sales, date) {
  return sales.filter((sale) => {
    const saleDate = new Date(`${sale.date}T12:00:00`)
    return saleDate.getFullYear() === date.getFullYear()
      && saleDate.getMonth() === date.getMonth()
      && saleDate.getDate() === date.getDate()
  })
}

function hourlyBars(sales) {
  const buckets = Array.from({ length: 12 }, () => 0)
  sales.forEach((sale, index) => {
    buckets[index % buckets.length] += Number(sale.value || 0)
  })

  return scaleBars(buckets)
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

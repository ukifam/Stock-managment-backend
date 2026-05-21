const storeModel = require('../models/storeModel')
const { formatCurrency } = require('../utils/formatters')

async function getDashboard() {
  const store = await storeModel.readStore()
  const summary = totals(store)

  return {
    metrics: [
      { label: 'Total Products', value: summary.totalProducts.toLocaleString('en-US'), delta: '+12%' },
      { label: 'Total Sales', value: formatCurrency(summary.totalSales), delta: '+8%' },
      { label: 'Total Purchases', value: summary.totalPurchases.toLocaleString('en-US'), delta: 'No active' },
      { label: 'Available Stock', value: `${summary.availableStock.toFixed(1)}%`, delta: '-6.7%' },
    ],
    salesBars: [48, 70, 36, 92, 58, 100, 76, 42, 64, 20, 82, 54],
    lowStock: lowStockAlerts(store),
    catalog: catalogItems(store),
  }
}

function totals(store) {
  const stockCapacity = store.inventory.reduce((sum, item) => sum + Number(item.capacity || 0), 0)
  const stockAvailable = store.inventory.reduce((sum, item) => sum + Number(item.stock || 0), 0)
  const salesValue = store.sales.reduce((sum, sale) => sum + Number(sale.value || 0), 0)
  const purchaseUnits = store.purchases.reduce((sum, purchase) => sum + Number(purchase.quantity || 0), 0)

  return {
    totalProducts: store.inventory.length,
    totalSales: salesValue,
    totalPurchases: purchaseUnits,
    availableStock: stockCapacity ? (stockAvailable / stockCapacity) * 100 : 0,
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
  return store.inventory.slice(0, 4).map((item) => ({
    sku: item.sku,
    name: item.item,
    type: item.category,
    price: formatCurrency(item.price),
    visual: catalogVisual(item.category),
  }))
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

const storeModel = require('../models/storeModel')
const { filterByPeriod } = require('../utils/filters')
const { formatCurrency, purchaseDto, saleDto } = require('../utils/formatters')

async function getReports({ period = 'yearly' }) {
  const store = await storeModel.readStore()
  const sales = filterByPeriod(store.sales, period)
  const purchases = filterByPeriod(store.purchases, period)
  const revenue = sales.reduce((sum, sale) => sum + Number(sale.value || 0), 0)
  const purchaseCost = purchases.reduce((sum, purchase) => sum + Number(purchase.quantity * purchase.unitPrice || 0), 0)
  const profit = revenue - purchaseCost
  const avgOrder = sales.length ? revenue / sales.length : 0

  return {
    metrics: [
      { label: 'Total Revenue', value: formatCurrency(revenue), note: '+12.4% vs last period' },
      { label: 'Total Profit', value: formatCurrency(profit), note: '+8.1% vs last period' },
      { label: 'Avg Order', value: formatCurrency(avgOrder), note: '-2.4% vs last period' },
      { label: 'Logistics Efficiency', value: '98.2%', note: 'Optimized target: 95%' },
    ],
    reportBars: [20, 34, 38, 31, 42, 71, 86],
    recentTransactions: [...sales.map(saleDto), ...purchases.map(purchaseDto)].slice(0, 8),
  }
}

module.exports = {
  getReports,
}

const storeModel = require('../models/storeModel')
const { filterByPeriod, filterByRange } = require('../utils/filters')
const { formatCurrency, purchaseDto, saleDto, expenseDto } = require('../utils/formatters')
const { currencyFromSettings } = require('../utils/settings')
const { buildAverageUnitCostIndex, computeMatchedGrossProfit, calculateSaleCostDetails } = require('../utils/profitCalculator')

const CREDIT_PURCHASE_STATUSES = ['pending', 'delayed']

async function getReports({ period = 'yearly', from, to, credit = 'all' }) {
  const store = await storeModel.readStore()
  const sales = selectRows(store.sales, period, from, to)
  const purchases = selectRows(store.purchases, period, from, to)
  const expenses = selectRows(store.expenses, period, from, to)
  const currency = currencyFromSettings(store.settings)

  const revenue = sales.reduce((sum, sale) => sum + Number(sale.value || 0), 0)
  const purchaseCost = purchases.reduce((sum, purchase) => sum + Number(purchase.quantity * purchase.unitPrice || 0), 0)
  const purchaseCostIndex = buildAverageUnitCostIndex(purchases, store.inventory)
  const matchedProfit = computeMatchedGrossProfit(sales, purchaseCostIndex, store.inventory, purchases)
  const costOfGoodsSold = matchedProfit.costOfGoodsSold
  const grossProfit = matchedProfit.grossProfit
  const expenseTotal = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)
  const taxes = expenseTaxTotal(expenses)
  const operatingExpenses = expenseTotal - taxes
  const netProfit = grossProfit - taxes - operatingExpenses
  const previous = previousPeriodTotals(store, period)
  const totalTransactions = sales.length + purchases.length + expenses.length
  const completedTransactions = [...sales, ...purchases].filter((row) => ['Given', 'Received', 'Completed', 'Confirmed'].includes(String(row.status || ''))).length

  const paymentMethods = summarizePaymentMethods(sales, currency)
  const reportSales = credit === 'salesCredit' ? sales.filter(isCreditSale) : sales
  const reportPurchases = credit === 'purchasesCredit' ? purchases.filter(isCreditPurchase) : purchases
  const creditSummary = summarizeCreditTotals(sales, purchases, currency)
  const detailPurchases = buildDetailList(reportPurchases, 'Purchase', purchaseTransaction, currency)
  const detailSales = buildDetailList(reportSales, 'Sale', (row, currencyValue, typeValue) => saleTransaction(row, currencyValue, typeValue, purchases, purchaseCostIndex, store.inventory), currency)
  const detailExpenses = buildDetailList(expenses, 'Expense', expenseTransaction, currency)
  const reportTransactions = [...detailPurchases, ...detailSales, ...detailExpenses]
    .sort((a, b) => new Date(`${b.date}T12:00:00`) - new Date(`${a.date}T12:00:00`))
    .slice(0, 12)

  // Inventory Valuation & Health
  const totalStockUnits = (store.inventory || []).reduce((sum, item) => sum + Number(item.stock || 0), 0)
  const totalInventoryValuation = (store.inventory || []).reduce((sum, item) => sum + Number(item.stock || 0) * Number(item.price || 0), 0)
  const lowStockCount = (store.inventory || []).filter(item => Number(item.stock || 0) <= Number(item.capacity || 25) && Number(item.stock || 0) > 0).length
  const outOfStockCount = (store.inventory || []).filter(item => Number(item.stock || 0) <= 0).length

  // Stock Discrepancies & Shrinkage from Movements
  let allMovements = []
  try {
    allMovements = await storeModel.StockMovement.find({}).lean()
  } catch (err) {
    allMovements = []
  }
  const filteredMovements = selectRows(allMovements, period, from, to)
  const shrinkageTypes = ['DAMAGE', 'LOSS', 'THEFT', 'ADJUSTMENT', 'PHYSICAL_COUNT', 'SUPPLIER_RETURN']
  const inventoryPriceMap = new Map((store.inventory || []).map(i => [i.sku, Number(i.price || 0)]))
  const inventoryNameMap = new Map((store.inventory || []).map(i => [i.sku, i.item]))

  const discrepancies = filteredMovements.filter(m => shrinkageTypes.includes(m.type) || m.quantity < 0)
  const totalLossUnits = Math.abs(discrepancies.filter(m => m.quantity < 0).reduce((sum, m) => sum + m.quantity, 0))
  const totalLossValue = Math.abs(discrepancies.filter(m => m.quantity < 0).reduce((sum, m) => sum + (m.quantity * (inventoryPriceMap.get(m.sku) || 0)), 0))

  return {
    metrics: [
      { label: 'Total Sales', value: formatCurrency(revenue, currency), note: `${sales.length} transactions` },
      { label: 'Total Purchases', value: formatCurrency(purchaseCost, currency), note: `${purchases.length} purchases` },
      { label: 'Gross Profit', value: formatCurrency(grossProfit, currency), note: 'Sales minus cost of sold products' },
      { label: 'Net Profit', value: formatCurrency(netProfit, currency), note: 'After taxes and expenses' },
      { label: 'Inventory Valuation', value: formatCurrency(totalInventoryValuation, currency), note: `${totalStockUnits} units in stock` },
      { label: 'Stock Loss / Shrinkage', value: formatCurrency(totalLossValue, currency), note: `${totalLossUnits} units discrepancy` },
    ],
    reportBars: periodBars(reportSales, period, from, to),
    topProducts: topProducts(reportSales, currency),
    topExpenses: topExpenseCategories(expenses, currency),
    paymentMethods,
    recentTransactions: reportTransactions,
    detailPurchases,
    detailSales,
    detailExpenses,
    inventoryValuation: {
      totalUnits: totalStockUnits,
      totalValuation: formatCurrency(totalInventoryValuation, currency),
      rawValuation: totalInventoryValuation,
      lowStockCount,
      outOfStockCount,
    },
    stockDiscrepancies: discrepancies.slice(0, 50).map(d => ({
      ...d,
      item: inventoryNameMap.get(d.sku) || d.sku,
      estimatedLoss: formatCurrency(Math.abs(d.quantity) * (inventoryPriceMap.get(d.sku) || 0), currency)
    })),
    summary: {
      salesCount: reportSales.length,
      purchasesCount: reportPurchases.length,
      expensesCount: expenses.length,
      totalTransactions: sales.length + purchases.length + expenses.length,
      totalSales: formatCurrency(revenue, currency),
      totalPurchases: formatCurrency(purchaseCost, currency),
      costOfGoodsSold: formatCurrency(costOfGoodsSold, currency),
      totalExpenses: formatCurrency(expenseTotal, currency),
      taxes: formatCurrency(taxes, currency),
      grossProfit: formatCurrency(grossProfit, currency),
      netProfit: formatCurrency(netProfit, currency),
      netCashFlow: formatCurrency(netProfit, currency),
      purchasesCash: creditSummary.purchasesCash,
      purchasesOnCredit: creditSummary.purchasesOnCredit,
      salesCash: creditSummary.salesCash,
      salesOnCredit: creditSummary.salesOnCredit,
      totalPayments: formatCurrency(purchaseCost + expenseTotal, currency),
      totalStockUnits,
      totalInventoryValuation: formatCurrency(totalInventoryValuation, currency),
      totalLossUnits,
      totalLossValue: formatCurrency(totalLossValue, currency),
      lowStockCount,
      outOfStockCount,
    },
  }
}

function selectRows(rows, period, from, to) {
  if (from || to) {
    return filterByRange(rows, from, to)
  }
  return filterByPeriod(rows, period)
}

function isCreditSale(sale) {
  return String(sale.payment || '').toLowerCase() === 'credit'
}

function isCreditPurchase(purchase) {
  return String(purchase.payment || '').toLowerCase() === 'credit'
    || CREDIT_PURCHASE_STATUSES.includes(String(purchase.status || '').toLowerCase())
}

function purchaseTotal(purchase) {
  return Number(purchase.quantity || 0) * Number(purchase.unitPrice || 0)
}

function getPaidAmount(row, total) {
  if (row.paidAmount !== undefined && row.paidAmount !== null) {
    return Math.min(total, Math.max(0, Number(row.paidAmount || 0)))
  }
  return isCreditSale(row) || isCreditPurchase(row) ? 0 : total
}

function getOutstanding(row, total, paidAmount) {
  if (row.outstanding !== undefined && row.outstanding !== null) {
    return Math.max(0, Number(row.outstanding || 0))
  }
  return isCreditSale(row) || isCreditPurchase(row) ? Math.max(0, total - paidAmount) : 0
}

function buildDetailList(rows, type, mapper, currency) {
  return rows
    .map((row) => mapper(row, currency, type))
    .sort((a, b) => new Date(`${b.date}T12:00:00`) - new Date(`${a.date}T12:00:00`))
}

function purchaseTransaction(row, currency) {
  const total = purchaseTotal(row)
  const paidAmount = getPaidAmount(row, total)
  const outstanding = getOutstanding(row, total, paidAmount)
  const dto = purchaseDto(row, currency)
  return {
    ...dto,
    type: 'Purchase',
    date: row.date,
    supplier: row.supplier,
    payment: row.payment || 'Cash',
    paidAmount: formatCurrency(paidAmount, currency),
    outstanding: formatCurrency(outstanding, currency),
    rawPaidAmount: paidAmount,
    rawOutstanding: outstanding,
  }
}

function saleTransaction(row, currency, typeValue, purchases = [], purchaseCostIndex = [], inventory = []) {
  const total = Number(row.value || 0)
  const paidAmount = getPaidAmount(row, total)
  const outstanding = getOutstanding(row, total, paidAmount)
  const dto = saleDto(row, currency)
  const costDetails = calculateSaleCostDetails(row, purchases, purchaseCostIndex, inventory)
  return {
    ...dto,
    type: 'Sale',
    date: row.date,
    customer: row.customer,
    payment: row.payment || 'Cash',
    paidAmount: formatCurrency(paidAmount, currency),
    outstanding: formatCurrency(outstanding, currency),
    rawPaidAmount: paidAmount,
    rawOutstanding: outstanding,
    rawPurchasePrice: costDetails.totalCost,
    purchasePrice: formatCurrency(costDetails.totalCost, currency),
    rawUnitPrice: Number(row.quantity || 1) > 0 ? total / Number(row.quantity || 1) : 0,
    unitPrice: formatCurrency(Number(row.quantity || 1) > 0 ? total / Number(row.quantity || 1) : 0, currency),
  }
}

function expenseTransaction(row, currency) {
  const dto = expenseDto(row, currency)
  return {
    ...dto,
    type: 'Expense',
    date: row.date,
    supplier: row.vendor || '',
    customer: '',
    payment: 'Cash',
    paidAmount: dto.value,
    outstanding: formatCurrency(0, currency),
    rawPaidAmount: Number(row.amount || 0),
    rawOutstanding: 0,
  }
}

function summarizeCreditTotals(sales, purchases, currency) {
  let purchasesCash = 0
  let purchasesOnCredit = 0
  let salesCash = 0
  let salesOnCredit = 0
  let totalPayments = 0

  purchases.forEach((purchase) => {
    const total = purchaseTotal(purchase)
    const paidAmount = getPaidAmount(purchase, total)
    const outstanding = getOutstanding(purchase, total, paidAmount)
    totalPayments += paidAmount
    if (isCreditPurchase(purchase)) {
      purchasesOnCredit += outstanding
      purchasesCash += paidAmount
    } else {
      purchasesCash += total
    }
  })

  sales.forEach((sale) => {
    const total = Number(sale.value || 0)
    const paidAmount = getPaidAmount(sale, total)
    const outstanding = getOutstanding(sale, total, paidAmount)
    totalPayments += paidAmount
    if (isCreditSale(sale)) {
      salesOnCredit += outstanding
      salesCash += paidAmount
    } else {
      salesCash += total
    }
  })

  return {
    purchasesCash: formatCurrency(purchasesCash, currency),
    purchasesOnCredit: formatCurrency(purchasesOnCredit, currency),
    salesCash: formatCurrency(salesCash, currency),
    salesOnCredit: formatCurrency(salesOnCredit, currency),
    totalPayments: formatCurrency(totalPayments, currency),
  }
}

function expenseTaxTotal(expenses) {
  return expenses.reduce((sum, expense) => {
    const category = String(expense.category || '')
    const description = String(expense.description || '')
    const isTax = /tax/i.test(category) || /tax/i.test(description)
    return sum + (isTax ? Number(expense.amount || 0) : 0)
  }, 0)
}

function summarizePaymentMethods(sales, currency) {
  const categories = sales.reduce((acc, sale) => {
    const method = classifyPaymentMethod(String(sale.payment || 'Unknown'))
    const existing = acc[method] || { method, count: 0, amount: 0 }
    existing.count += 1
    existing.amount += Number(sale.value || 0)
    acc[method] = existing
    return acc
  }, {})

  return Object.values(categories)
    .sort((a, b) => b.amount - a.amount)
    .map((entry) => ({
      method: entry.method,
      count: entry.count,
      amount: formatCurrency(entry.amount, currency),
    }))
}

function classifyPaymentMethod(payment) {
  const normalized = payment.trim().toLowerCase()
  if (/mobile|mpesa|m-pesa|gpay|apple pay|google pay/.test(normalized)) return 'Mobile payment'
  if (/cash/.test(normalized)) return 'Cash'
  if (/check|cheque/.test(normalized)) return 'Check'
  if (/wire|transfer|bank|ach/.test(normalized)) return 'Bank transfer'
  if (/credit/.test(normalized)) return 'Credit'
  return payment || 'Other'
}

function buildRecentTransactions(sales, purchases, expenses, currency) {
  return [
    ...buildDetailList(sales, 'Sale', saleTransaction, currency),
    ...buildDetailList(purchases, 'Purchase', purchaseTransaction, currency),
    ...buildDetailList(expenses, 'Expense', expenseTransaction, currency),
  ]
    .sort((a, b) => new Date(`${b.date}T12:00:00`) - new Date(`${a.date}T12:00:00`))
    .slice(0, 12)
}

function topProducts(sales, currency) {
  const productTotals = sales.reduce((acc, sale) => {
    const item = sale.item || 'Unknown'
    const existing = acc[item] || { item, quantity: 0, revenue: 0 }
    existing.quantity += Number(sale.quantity || 0)
    existing.revenue += Number(sale.value || 0)
    acc[item] = existing
    return acc
  }, {})

  return Object.values(productTotals)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
    .map((product) => ({
      ...product,
      value: formatCurrency(product.revenue, currency),
    }))
}

function topExpenseCategories(expenses, currency) {
  const categoryTotals = expenses.reduce((acc, expense) => {
    const category = expense.category || 'Uncategorized'
    const existing = acc[category] || { category, amount: 0 }
    existing.amount += Number(expense.amount || 0)
    acc[category] = existing
    return acc
  }, {})

  return Object.values(categoryTotals)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)
    .map((category) => ({
      ...category,
      amount: formatCurrency(category.amount, currency),
    }))
}

function periodBars(sales, period, from, to) {
  const bucketCount = 7
  const buckets = Array.from({ length: bucketCount }, () => 0)

  sales.forEach((sale) => {
    const date = new Date(`${sale.date}T12:00:00`)
    const index = getBucketIndex(date, period, from, to)
    buckets[index] += Number(sale.value || 0)
  })

  return scaleBars(buckets)
}

function getBucketIndex(date, period, from, to) {
  if (from || to) {
    return date.getDay()
  }
  if (period === 'daily') {
    return date.getHours() % 7
  }
  return date.getDay()
}

function scaleBars(values) {
  const max = Math.max(...values, 0)
  if (!max) return values.map(() => 0)
  return values.map((value) => Math.max(8, Math.round((value / max) * 100)))
}

function previousPeriodTotals(store, period) {
  const previousSales = rowsInPreviousPeriod(store.sales, period)
  const previousPurchases = rowsInPreviousPeriod(store.purchases, period)
  const previousExpenses = rowsInPreviousPeriod(store.expenses, period)
  const purchaseCostIndex = buildAverageUnitCostIndex(store.purchases, store.inventory)
  const matched = computeMatchedGrossProfit(previousSales, purchaseCostIndex, store.inventory)
  const expenseAmount = previousExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)

  return {
    revenue: matched.revenue,
    expenses: expenseAmount,
    profit: matched.grossProfit - expenseAmount,
  }
}

function rowsInPreviousPeriod(rows, period) {
  const now = new Date()
  return rows.filter((row) => {
    const date = new Date(`${row.date}T12:00:00`)
    if (period === 'daily') return sameDay(date, offsetDate(now, -1))
    if (period === 'weekly') return daysBetween(date, now) >= 7 && daysBetween(date, now) < 14
    if (period === 'monthly') {
      const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      return date.getFullYear() === previous.getFullYear() && date.getMonth() === previous.getMonth()
    }
    if (period === 'quarterly') {
      const currentQuarter = Math.floor(now.getMonth() / 3)
      const previousQuarterDate = new Date(now.getFullYear(), currentQuarter * 3 - 3, 1)
      return date.getFullYear() === previousQuarterDate.getFullYear() && Math.floor(date.getMonth() / 3) === Math.floor(previousQuarterDate.getMonth() / 3)
    }
    return date.getFullYear() === now.getFullYear() - 1
  })
}

function changeNote(current, previous) {
  if (!previous) return current ? 'New activity' : 'No activity'
  const change = ((current - previous) / Math.abs(previous)) * 100
  return `${change >= 0 ? '+' : ''}${change.toFixed(1)}% vs last period`
}

function sameDay(left, right) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()
}

function offsetDate(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function daysBetween(left, right) {
  const start = new Date(left.getFullYear(), left.getMonth(), left.getDate())
  const end = new Date(right.getFullYear(), right.getMonth(), right.getDate())
  return Math.floor((end.getTime() - start.getTime()) / 86400000)
}

module.exports = {
  getReports,
}

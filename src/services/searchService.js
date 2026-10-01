const storeModel = require('../models/storeModel')
const Loan = require('../models/Loan')
const PartnerTransfer = require('../models/PartnerTransfer')
const { searchRows } = require('../utils/filters')
const { tenantFilter } = require('../utils/tenantContext')

async function searchAll(query = '') {
  const needle = String(query || '').trim()
  if (needle.length < 2) return { results: [], count: 0 }

  const store = await storeModel.readStore()
  const [loans, stockMovements, partnerTransfers] = await Promise.all([
    Loan.find(tenantFilter()).lean(),
    storeModel.StockMovement.find(tenantFilter()).lean(),
    PartnerTransfer.find(tenantFilter()).lean(),
  ])
  const inventoryBySku = new Map(store.inventory.map((row) => [row.sku, row.item]))
  const results = [
    ...searchRows(store.inventory, needle).map((row) => result('Inventory', row.sku, row.item, `${row.sku} · ${row.category}`, 'inventory')),
    ...searchRows(store.purchases, needle).map((row) => result('Purchase', row.id, row.item, `${row.supplier || 'Supplier'} · ${row.date}`, 'purchases')),
    ...searchRows(store.sales, needle).map((row) => result('Sale', row.id, row.item || 'Sale', `${row.customer || 'Customer'} · ${row.date}`, 'sales')),
    ...searchRows(store.expenses, needle).map((row) => result('Expense', row.id || row.reference, row.description || row.category || 'Expense', `${row.vendor || 'Expense'} · ${row.date}`, 'expenses')),
    ...searchRows(loans, needle).map((row) => result('Loan', row.id, row.partyName, `${row.type} · ${row.status} · ${row.purpose || 'Loan'}`, row.type === 'TAKEN' ? 'loans-taken' : 'loans-given')),
    ...searchRows(partnerTransfers, needle).map((row) => result('Transfer', row.reference, row.item, `${row.partner} · ${row.remainingQuantity ?? (row.quantityReceived - row.quantitySold - row.quantityReturned)} remaining · ${row.status}`, 'transfers')),
    ...searchRows(stockMovements.map((row) => ({ ...row, item: inventoryBySku.get(row.sku) || '' })), needle)
      .map((row) => result('Stock Movement', row._id?.toString() || row.reference || row.sku, row.item || row.sku, `${row.type} · ${row.reason || row.date}`, 'stock-movements')),
  ]

  return { results: results.slice(0, 60), count: results.length }
}

function result(type, id, title, subtitle, page) {
  return { id: String(id || `${type}-${title}`), type, title: String(title || type), subtitle: String(subtitle || ''), page }
}

async function searchInventory(query = '') {
  const store = await storeModel.readStore()
  const currency = currencyFromSettings(store.settings)
  const results = searchRows(store.inventory, query).map((row) => inventoryDto(row, currency))
  return { rows: results, count: results.length }
}

module.exports = {
  searchAll,
  searchInventory,
}

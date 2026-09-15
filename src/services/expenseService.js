const storeModel = require('../models/storeModel')
const httpError = require('../utils/httpError')
const CacheManager = require('../utils/cache')

async function listExpenses({ page = 1, limit = 50, search = '', category = '' }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1)
  const limitNum = Math.min(1000, Math.max(1, parseInt(limit, 10) || 50))

  const cacheKey = `expenses:list:${pageNum}:${limitNum}:${search}:${category}`
  const cached = CacheManager.get(cacheKey)
  if (cached) return cached

  const store = await storeModel.readStore()
  let rows = store.expenses || []

  if (category) {
    rows = rows.filter((r) => (r.category || '').toLowerCase() === category.toLowerCase())
  }

  if (search) {
    const q = search.toLowerCase()
    rows = rows.filter(
      (r) =>
        (r.description || '').toLowerCase().includes(q) ||
        (r.vendor || '').toLowerCase().includes(q) ||
        (r.reference || '').toLowerCase().includes(q)
    )
  }

  const totalCount = rows.length
  const totalPages = Math.ceil(totalCount / limitNum)
  const skip = (pageNum - 1) * limitNum
  const paginatedRows = rows.slice(skip, skip + limitNum)

  const result = {
    rows: paginatedRows,
    count: totalCount,
    page: pageNum,
    pageSize: limitNum,
    totalPages,
    hasNextPage: pageNum < totalPages,
    hasPrevPage: pageNum > 1,
  }

  CacheManager.set(cacheKey, result, 60000)
  return result
}

async function getExpense(id) {
  const store = await storeModel.readStore()
  const item = (store.expenses || []).find((r) => r._id?.toString() === id || r.id === id)
  if (!item) throw httpError(404, 'Expense not found')
  return item
}

async function createExpense(payload) {
  if (!payload || !payload.date || typeof payload.amount === 'undefined') {
    throw httpError(400, 'Missing required fields: date and amount')
  }

  const store = await storeModel.readStore()
  store.expenses = store.expenses || []

  const item = {
    date: payload.date,
    amount: Number(payload.amount) || 0,
    category: payload.category || 'General',
    description: payload.description || '',
    vendor: payload.vendor || '',
    reference: payload.reference || '',
    status: payload.status || 'Recorded',
    id: payload.reference || `EX-${Date.now()}`,
  }

  const existingIndex = store.expenses.findIndex((e) => e.id === item.id || e._id?.toString() === item.id)
  if (existingIndex >= 0) {
    store.expenses[existingIndex] = { ...store.expenses[existingIndex], ...item }
  } else {
    store.expenses.unshift(item)
  }

  await storeModel.writeStore(store)
  CacheManager.clear()
  return item
}

async function updateExpense(id, body) {
  const store = await storeModel.readStore()
  store.expenses = store.expenses || []

  const index = store.expenses.findIndex((expense) => expense.id === id || expense._id?.toString() === id)
  if (index === -1) throw httpError(404, 'Expense not found')

  const existing = store.expenses[index]
  const normalizedReference = typeof body.reference === 'string' ? body.reference.trim() : undefined
  const nextId = normalizedReference || existing.id || existing._id?.toString() || `EX-${Date.now()}`
  const nextExpense = {
    ...existing,
    date: body.date || existing.date,
    amount: typeof body.amount !== 'undefined' ? Number(body.amount) : existing.amount,
    category: body.category || existing.category || 'General',
    description: body.description ?? existing.description ?? '',
    vendor: body.vendor ?? existing.vendor ?? '',
    reference: normalizedReference ?? existing.reference ?? '',
    status: body.status || existing.status || 'Recorded',
    id: nextId,
  }

  const hasDuplicateReference = store.expenses.some((expense, expenseIndex) => {
    if (expenseIndex === index) return false
    const expenseKey = expense.id || expense._id?.toString()
    return expenseKey && expenseKey === nextId
  })

  if (hasDuplicateReference) {
    throw httpError(409, 'Expense reference already exists')
  }

  store.expenses[index] = nextExpense
  await storeModel.writeStore(store)
  CacheManager.clear()
  return nextExpense
}

async function deleteExpense(id) {
  const store = await storeModel.readStore()
  store.expenses = store.expenses || []

  const index = store.expenses.findIndex((expense) => expense.id === id || expense._id?.toString() === id)
  if (index === -1) throw httpError(404, 'Expense not found')

  store.expenses.splice(index, 1)
  await storeModel.writeStore(store)
  try {
    const Expense = require('../models/Expense')
    await Expense.deleteOne({ $or: [{ id }, { _id: id }] })
  } catch (e) {
    console.error('Error deleting expense from MongoDB:', e)
  }
  CacheManager.clear()
  return { success: true, id }
}

module.exports = { listExpenses, getExpense, createExpense, updateExpense, deleteExpense }

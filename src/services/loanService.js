const Loan = require('../models/Loan')
const storeModel = require('../models/storeModel')
const { auditActor } = require('../utils/tenantContext')
const httpError = require('../utils/httpError')
const { escapeRegex } = require('../utils/inventoryMatch')

// Counting documents would reuse ids after a deletion, so continue from the highest one.
async function generateLoanId(type) {
  const prefix = type === 'GIVEN' ? 'LG' : 'LT'
  const loans = await Loan.find(storeModel.branchScopedQuery({ type })).select('id').lean()
  const highest = loans.reduce((max, loan) => {
    const match = String(loan.id || '').match(new RegExp(`^${prefix}-(\\d+)$`))
    return match ? Math.max(max, Number(match[1])) : max
  }, 1000)
  return `${prefix}-${highest + 1}`
}

async function listLoans({ type, status, search, page = 1, limit = 50 } = {}) {
  await storeModel.ensureStore()
  const query = {}
  if (type) query.type = type.toUpperCase()
  if (status) query.status = status.toUpperCase()
  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i')
    query.$or = [
      { id: regex },
      { partyName: regex },
      { phone: regex },
      { purpose: regex },
      { reference: regex },
    ]
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1)
  const limitNum = Math.min(1000, Math.max(1, parseInt(limit, 10) || 50))
  const [rows, count] = await Promise.all([
    Loan.find(storeModel.branchScopedQuery(query)).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum),
    Loan.countDocuments(storeModel.branchScopedQuery(query)),
  ])

  return { rows, count, page: pageNum, limit: limitNum }
}

async function getLoanById(id) {
  await storeModel.ensureStore()
  const loan = await Loan.findOne(storeModel.branchScopedQuery({ id }))
  if (!loan) {
    throw httpError(404, `Loan with ID ${id} not found`)
  }
  return loan
}

async function createLoan(payload) {
  await storeModel.ensureStore()
  const type = payload.type ? payload.type.toUpperCase() : 'GIVEN'
  if (!['GIVEN', 'TAKEN'].includes(type)) {
    throw httpError(400, "Loan type must be either 'GIVEN' or 'TAKEN'")
  }

  if (!payload.partyName || !payload.partyName.trim()) {
    throw httpError(400, 'Borrower / Lender name is required')
  }

  const principal = Number(payload.principalAmount || 0)
  if (!Number.isFinite(principal) || principal <= 0) {
    throw httpError(400, 'Principal amount must be greater than 0')
  }

  const interestRate = Number(payload.interestRate || 0)
  if (!Number.isFinite(interestRate) || interestRate < 0) throw httpError(400, 'Interest rate cannot be negative')
  const interestAmount = Number(
    payload.interestAmount != null
      ? payload.interestAmount
      : (principal * interestRate) / 100
  )
  const totalAmount = principal + interestAmount
  const customId = String(payload.id || '').trim() || (await generateLoanId(type))
  if (await Loan.exists(storeModel.branchScopedQuery({ id: customId }))) throw httpError(409, `Loan ${customId} already exists`)
  if (payload.dueDate && payload.startDate && payload.dueDate < payload.startDate) throw httpError(400, 'Due date cannot be before the start date')
  const today = new Date().toISOString().slice(0, 10)

  const loan = new Loan(storeModel.withBranchFields({
    id: customId,
    type,
    partyName: payload.partyName.trim(),
    partyType: payload.partyType || 'INDIVIDUAL',
    phone: payload.phone || '',
    email: payload.email || '',
    idNumber: payload.idNumber || '',
    principalAmount: principal,
    interestRate,
    interestAmount,
    totalAmount,
    totalRepaid: 0,
    remainingBalance: totalAmount,
    startDate: payload.startDate || today,
    dueDate: payload.dueDate || today,
    paymentMethod: payload.paymentMethod || 'Bank Transfer',
    installmentType: payload.installmentType || 'LUMP_SUM',
    status: 'ACTIVE',
    purpose: payload.purpose || '',
    collateral: payload.collateral || '',
    notes: payload.notes || '',
    repayments: [],
  }))

  await loan.save()
  return loan
}

async function recordRepayment(id, payload) {
  await storeModel.ensureStore()
  const loan = await Loan.findOne(storeModel.branchScopedQuery({ id }))
  if (!loan) {
    throw httpError(404, `Loan with ID ${id} not found`)
  }

  const amount = Number(payload.amount || 0)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw httpError(400, 'Repayment amount must be greater than 0')
  }
  if (loan.status === 'PAID' || Number(loan.remainingBalance || 0) <= 0) throw httpError(409, 'This loan is already fully paid')
  if (amount > Number(loan.remainingBalance || 0) + 0.005) {
    throw httpError(400, `Repayment exceeds the remaining balance of ${Number(loan.remainingBalance || 0).toLocaleString('en-US')}`)
  }

  const repaymentId = `REP-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  const repayment = {
    repaymentId,
    date: payload.date || new Date().toISOString().slice(0, 10),
    amount,
    paymentMethod: payload.paymentMethod || 'Bank Transfer',
    reference: payload.reference || '',
    notes: payload.notes || '',
    recordedBy: auditActor().username || payload.recordedBy || 'System',
  }

  loan.repayments.push(repayment)
  loan.totalRepaid = (loan.totalRepaid || 0) + amount
  loan.remainingBalance = Math.max(0, loan.totalAmount - loan.totalRepaid)

  if (loan.remainingBalance <= 0) {
    loan.status = 'PAID'
  }

  loan.updatedBy = auditActor()
  await loan.save()
  return loan
}

async function updateLoan(id, payload) {
  await storeModel.ensureStore()
  const loan = await Loan.findOne(storeModel.branchScopedQuery({ id }))
  if (!loan) {
    throw httpError(404, `Loan with ID ${id} not found`)
  }

  const updatableFields = [
    'partyName',
    'partyType',
    'phone',
    'email',
    'idNumber',
    'dueDate',
    'status',
    'purpose',
    'collateral',
    'notes',
    'installmentType',
  ]

  updatableFields.forEach((field) => {
    if (payload[field] !== undefined) {
      loan[field] = payload[field]
    }
  })

  loan.updatedBy = auditActor()
  await loan.save()
  return loan
}

async function deleteLoan(id) {
  await storeModel.ensureStore()
  const loan = await Loan.findOneAndDelete(storeModel.branchScopedQuery({ id }))
  if (!loan) {
    throw httpError(404, `Loan with ID ${id} not found`)
  }
  return { success: true, id }
}

async function getLoanMetrics() {
  await storeModel.ensureStore()
  const loans = await Loan.find(storeModel.branchScopedQuery())

  let totalGivenPrincipal = 0
  let totalGivenOutstanding = 0
  let totalGivenRepaid = 0
  let activeGivenCount = 0

  let totalTakenPrincipal = 0
  let totalTakenOutstanding = 0
  let totalTakenRepaid = 0
  let activeTakenCount = 0

  let overdueCount = 0
  const today = new Date().toISOString().slice(0, 10)

  loans.forEach((l) => {
    const isOverdue = l.status === 'ACTIVE' && l.dueDate && l.dueDate < today

    if (l.type === 'GIVEN') {
      totalGivenPrincipal += l.principalAmount || 0
      totalGivenOutstanding += l.remainingBalance || 0
      totalGivenRepaid += l.totalRepaid || 0
      if (l.status === 'ACTIVE') activeGivenCount++
    } else {
      totalTakenPrincipal += l.principalAmount || 0
      totalTakenOutstanding += l.remainingBalance || 0
      totalTakenRepaid += l.totalRepaid || 0
      if (l.status === 'ACTIVE') activeTakenCount++
    }

    if (isOverdue) overdueCount++
  })

  return {
    given: {
      principal: totalGivenPrincipal,
      outstanding: totalGivenOutstanding,
      repaid: totalGivenRepaid,
      activeCount: activeGivenCount,
    },
    taken: {
      principal: totalTakenPrincipal,
      outstanding: totalTakenOutstanding,
      repaid: totalTakenRepaid,
      activeCount: activeTakenCount,
    },
    netPosition: totalGivenOutstanding - totalTakenOutstanding,
    overdueCount,
    totalLoans: loans.length,
  }
}

module.exports = {
  listLoans,
  getLoanById,
  createLoan,
  recordRepayment,
  updateLoan,
  deleteLoan,
  getLoanMetrics,
}

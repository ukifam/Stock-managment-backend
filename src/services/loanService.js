const Loan = require('../models/Loan')
const storeModel = require('../models/storeModel')

async function generateLoanId(type) {
  const prefix = type === 'GIVEN' ? 'LG' : 'LT'
  const count = await Loan.countDocuments({ ...storeModel.tenantFilter(), type })
  const nextNum = 1000 + count + 1
  return `${prefix}-${nextNum}`
}

async function listLoans({ type, status, search, page = 1, limit = 50 } = {}) {
  await storeModel.ensureStore()
  const query = {}
  if (type) query.type = type.toUpperCase()
  if (status) query.status = status.toUpperCase()
  if (search) {
    const regex = new RegExp(search, 'i')
    query.$or = [
      { id: regex },
      { partyName: regex },
      { phone: regex },
      { purpose: regex },
      { reference: regex },
    ]
  }

  const skip = (Math.max(1, page) - 1) * limit
  const [rows, count] = await Promise.all([
    Loan.find(storeModel.scopedQuery(query)).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Loan.countDocuments(storeModel.scopedQuery(query)),
  ])

  return { rows, count, page: Number(page), limit: Number(limit) }
}

async function getLoanById(id) {
  await storeModel.ensureStore()
  const loan = await Loan.findOne({ ...storeModel.tenantFilter(), id })
  if (!loan) {
    throw new Error(`Loan with ID ${id} not found`)
  }
  return loan
}

async function createLoan(payload) {
  await storeModel.ensureStore()
  const type = payload.type ? payload.type.toUpperCase() : 'GIVEN'
  if (!['GIVEN', 'TAKEN'].includes(type)) {
    throw new Error("Loan type must be either 'GIVEN' or 'TAKEN'")
  }

  if (!payload.partyName || !payload.partyName.trim()) {
    throw new Error('Borrower / Lender name is required')
  }

  const principal = Number(payload.principalAmount || 0)
  if (principal <= 0) {
    throw new Error('Principal amount must be greater than 0')
  }

  const interestRate = Number(payload.interestRate || 0)
  const interestAmount = Number(
    payload.interestAmount != null
      ? payload.interestAmount
      : (principal * interestRate) / 100
  )
  const totalAmount = principal + interestAmount
  const customId = payload.id || (await generateLoanId(type))
  const today = new Date().toISOString().slice(0, 10)

  const loan = new Loan(storeModel.withTenantFields({
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
  const loan = await Loan.findOne({ ...storeModel.tenantFilter(), id })
  if (!loan) {
    throw new Error(`Loan with ID ${id} not found`)
  }

  const amount = Number(payload.amount || 0)
  if (amount <= 0) {
    throw new Error('Repayment amount must be greater than 0')
  }

  const repaymentId = `REP-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  const repayment = {
    repaymentId,
    date: payload.date || new Date().toISOString().slice(0, 10),
    amount,
    paymentMethod: payload.paymentMethod || 'Bank Transfer',
    reference: payload.reference || '',
    notes: payload.notes || '',
    recordedBy: payload.recordedBy || 'Admin',
  }

  loan.repayments.push(repayment)
  loan.totalRepaid = (loan.totalRepaid || 0) + amount
  loan.remainingBalance = Math.max(0, loan.totalAmount - loan.totalRepaid)

  if (loan.remainingBalance <= 0) {
    loan.status = 'PAID'
  }

  await loan.save()
  return loan
}

async function updateLoan(id, payload) {
  await storeModel.ensureStore()
  const loan = await Loan.findOne({ ...storeModel.tenantFilter(), id })
  if (!loan) {
    throw new Error(`Loan with ID ${id} not found`)
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

  await loan.save()
  return loan
}

async function deleteLoan(id) {
  await storeModel.ensureStore()
  const loan = await Loan.findOneAndDelete({ ...storeModel.tenantFilter(), id })
  if (!loan) {
    throw new Error(`Loan with ID ${id} not found`)
  }
  return { success: true, id }
}

async function getLoanMetrics() {
  await storeModel.ensureStore()
  const loans = await Loan.find(storeModel.tenantFilter())

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

const mongoose = require('mongoose')

const repaymentSchema = new mongoose.Schema(
  {
    repaymentId: { type: String, required: true },
    date: { type: String, required: true },
    amount: { type: Number, required: true },
    paymentMethod: { type: String, default: 'Bank Transfer' },
    reference: { type: String, default: '' },
    notes: { type: String, default: '' },
    recordedBy: { type: String, default: 'Admin' },
  },
  { _id: false, timestamps: true }
)

const loanSchema = new mongoose.Schema(
  {
    ownerKey: { type: String, default: 'legacy', index: true },
    ownerEmail: { type: String, default: 'info@ukifam.com', lowercase: true, trim: true },
    id: { type: String, required: true, index: true },
    type: { type: String, required: true, enum: ['GIVEN', 'TAKEN'], index: true },
    partyName: { type: String, required: true, index: true },
    partyType: {
      type: String,
      default: 'INDIVIDUAL',
      enum: ['BANK', 'INDIVIDUAL', 'EMPLOYEE', 'INVESTOR', 'OTHER'],
      index: true,
    },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    idNumber: { type: String, default: '' },
    principalAmount: { type: Number, required: true },
    interestRate: { type: Number, default: 0 },
    interestAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    totalRepaid: { type: Number, default: 0 },
    remainingBalance: { type: Number, required: true },
    startDate: { type: String, required: true, index: true },
    dueDate: { type: String, required: true, index: true },
    paymentMethod: { type: String, default: 'Bank Transfer' },
    installmentType: {
      type: String,
      default: 'LUMP_SUM',
      enum: ['LUMP_SUM', 'MONTHLY', 'WEEKLY', 'CUSTOM'],
    },
    status: {
      type: String,
      default: 'ACTIVE',
      enum: ['ACTIVE', 'PAID', 'OVERDUE', 'DEFAULTED'],
      index: true,
    },
    purpose: { type: String, default: '' },
    collateral: { type: String, default: '' },
    notes: { type: String, default: '' },
    repayments: { type: [repaymentSchema], default: [] },
  },
  { timestamps: true }
)

loanSchema.index({ type: 1, status: 1, startDate: -1 })
loanSchema.index({ ownerKey: 1, id: 1 }, { unique: true })

module.exports = mongoose.model('Loan', loanSchema)

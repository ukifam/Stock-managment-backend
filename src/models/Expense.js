const mongoose = require('mongoose')

const expenseItemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true },
    category: { type: String, default: 'General' },
    amount: { type: Number, required: true, default: 0 },
  },
  { _id: false }
)

const expenseSchema = new mongoose.Schema(
  {
    id: { type: String, index: true },
    ownerKey: { type: String, default: 'legacy', index: true },
    ownerEmail: { type: String, default: 'info@ukifam.com', lowercase: true, trim: true },
    date: { type: String, required: true, index: true },
    amount: { type: Number, required: true },
    subtotal: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    category: { type: String, default: 'General', index: true },
    description: { type: String, default: '' },
    vendor: { type: String, default: '' },
    payment: { type: String, default: 'Cash' },
    reference: { type: String, default: '' },
    status: { type: String, default: 'Recorded', index: true },
    items: { type: [expenseItemSchema], default: [] },
  },
  { timestamps: true }
)

expenseSchema.index({ date: 1, category: 1 })
expenseSchema.index({ ownerKey: 1, id: 1 })

module.exports = mongoose.model('Expense', expenseSchema)

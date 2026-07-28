const mongoose = require('mongoose')

const expenseSchema = new mongoose.Schema(
  {
    id: { type: String, index: true },
    date: { type: String, required: true, index: true },
    amount: { type: Number, required: true },
    category: { type: String, default: 'General', index: true },
    description: { type: String, default: '' },
    vendor: { type: String, default: '' },
    reference: { type: String, default: '' },
    status: { type: String, default: 'Recorded', index: true },
  },
  { timestamps: true }
)

expenseSchema.index({ date: 1, category: 1 })

module.exports = mongoose.model('Expense', expenseSchema)

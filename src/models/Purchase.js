const mongoose = require('mongoose')

const purchaseItemSchema = new mongoose.Schema(
  {
    sku: { type: String, default: '' },
    item: { type: String, required: true },
    category: { type: String, default: 'General' },
    quantity: { type: Number, required: true, default: 1 },
    unitPrice: { type: Number, required: true, default: 0 },
    total: { type: Number, required: true, default: 0 },
  },
  { _id: false }
)

const purchaseSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, index: true },
    id: { type: String, required: true, unique: true, trim: true },
    supplier: { type: String, default: '', index: true },
    phone: { type: String, default: '' },
    item: { type: String, default: '' },
    sku: { type: String, default: '', index: true },
    category: { type: String, default: 'Uncategorized', index: true },
    extractedText: { type: String, default: '' },
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, default: 0 },
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    value: { type: Number, default: 0 },
    payment: { type: String, default: 'Cash' },
    paidAmount: { type: Number, default: 0 },
    outstanding: { type: Number, default: 0 },
    status: { type: String, default: 'Received', index: true },
    items: { type: [purchaseItemSchema], default: [] },
  },
  { timestamps: true }
)

// Compound index for common queries
purchaseSchema.index({ date: -1, status: 1 })

module.exports = mongoose.model('Purchase', purchaseSchema)

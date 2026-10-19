const mongoose = require('mongoose')

const saleItemSchema = new mongoose.Schema(
  {
    sku: { type: String, default: '' },
    item: { type: String, required: true },
    category: { type: String, default: 'General' },
    quantity: { type: Number, required: true, default: 1 },
    originalQuantity: { type: Number, default: 0 },
    originalUnit: { type: String, default: '' },
    convertedQuantity: { type: Number, default: 0 },
    convertedUnit: { type: String, default: '' },
    unitPrice: { type: Number, required: true, default: 0 },
    total: { type: Number, required: true, default: 0 },
    costBasis: { type: Number, min: 0 },
    costOfGoodsSold: { type: Number, min: 0, default: 0 },
    grossProfit: { type: Number, default: 0 },
    grossMarginPercent: { type: Number, default: 0 },
  },
  { _id: false }
)

const saleSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, index: true },
    ownerKey: { type: String, default: 'legacy', index: true },
    ownerEmail: { type: String, default: 'info@ukifam.com', lowercase: true, trim: true },
    branchCode: { type: String, default: 'MAIN', trim: true, uppercase: true, index: true },
    createdBy: { id: String, username: String, email: String },
    updatedBy: { id: String, username: String, email: String },
    id: { type: String, required: true, trim: true },
    source: { type: String, default: 'pos', index: true },
    reference: { type: String, default: '' },
    customer: { type: String, required: true, index: true },
    phone: { type: String, default: '' },
    item: { type: String, default: '' },
    sku: { type: String, default: '', index: true },
    category: { type: String, default: 'Uncategorized', index: true },
    extractedText: { type: String, default: '' },
    quantity: { type: Number, default: 1 },
    originalQuantity: { type: Number, default: 0 },
    originalUnit: { type: String, default: '', trim: true, lowercase: true },
    convertedQuantity: { type: Number, default: 0 },
    convertedUnit: { type: String, default: '', trim: true, lowercase: true },
    warehouseCode: { type: String, default: '', trim: true, uppercase: true },
    customerId: { type: String, default: '' },
    serialNumber: { type: String, default: '' },
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    value: { type: Number, default: 0 },
    netRevenue: { type: Number, default: 0 },
    costOfGoodsSold: { type: Number, default: 0 },
    grossProfit: { type: Number, default: 0 },
    grossMarginPercent: { type: Number, default: 0 },
    payment: { type: String, default: 'Cash' },
    paidAmount: { type: Number, default: 0 },
    outstanding: { type: Number, default: 0 },
    status: { type: String, default: 'Completed', index: true },
    items: { type: [saleItemSchema], default: [] },
  },
  { timestamps: true }
)

// Compound index for common queries
saleSchema.index({ date: -1, status: 1 })
saleSchema.index({ ownerKey: 1, branchCode: 1, id: 1 }, { unique: true })

module.exports = mongoose.model('Sale', saleSchema)

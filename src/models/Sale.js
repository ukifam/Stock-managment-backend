const mongoose = require('mongoose')

const saleSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, index: true },
    id: { type: String, required: true, unique: true, trim: true },
    customer: { type: String, required: true, index: true },
    phone: { type: String, default: '' },
    item: { type: String, required: true },
    sku: { type: String, default: '', index: true },
    category: { type: String, default: 'Uncategorized', index: true },
    extractedText: { type: String, default: '' },
    quantity: { type: Number, default: 1 },
    value: { type: Number, default: 0 },
    payment: { type: String, default: 'Credit' },
    paidAmount: { type: Number, default: 0 },
    outstanding: { type: Number, default: 0 },
    status: { type: String, default: 'Draft', index: true },
  },
  { timestamps: true }
);

// Compound index for common queries
saleSchema.index({ date: -1, status: 1 });

module.exports = mongoose.model('Sale', saleSchema)

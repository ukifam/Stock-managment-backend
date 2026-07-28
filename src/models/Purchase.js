const mongoose = require('mongoose')

const purchaseSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, index: true },
    id: { type: String, required: true, unique: true, trim: true },
    supplier: { type: String, default: '', index: true },
    phone: { type: String, default: '' },
    item: { type: String, required: true },
    sku: { type: String, default: '', index: true },
    category: { type: String, default: 'Uncategorized', index: true },
    extractedText: { type: String, default: '' },
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, default: 0 },
    payment: { type: String, default: 'Cash' },
    paidAmount: { type: Number, default: 0 },
    outstanding: { type: Number, default: 0 },
    status: { type: String, default: 'Pending', index: true },
  },
  { timestamps: true }
);

// Compound index for common queries
purchaseSchema.index({ date: -1, status: 1 });

module.exports = mongoose.model('Purchase', purchaseSchema)

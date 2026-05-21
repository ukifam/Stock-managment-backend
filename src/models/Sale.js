const mongoose = require('mongoose')

const saleSchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    id: { type: String, required: true, unique: true, trim: true },
    customer: { type: String, required: true },
    phone: { type: String, default: '' },
    item: { type: String, required: true },
    sku: { type: String, default: '' },
    category: { type: String, default: 'Uncategorized' },
    quantity: { type: Number, default: 1 },
    value: { type: Number, default: 0 },
    payment: { type: String, default: 'Credit' },
    status: { type: String, default: 'Draft' },
  },
  { timestamps: true }
)

module.exports = mongoose.model('Sale', saleSchema)

const mongoose = require('mongoose')

const purchaseSchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    id: { type: String, required: true, unique: true, trim: true },
    supplier: { type: String, required: true },
    phone: { type: String, default: '' },
    item: { type: String, required: true },
    sku: { type: String, default: '' },
    category: { type: String, default: 'Uncategorized' },
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, default: 0 },
    status: { type: String, default: 'Pending' },
  },
  { timestamps: true }
)

module.exports = mongoose.model('Purchase', purchaseSchema)

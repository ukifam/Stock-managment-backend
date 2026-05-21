const mongoose = require('mongoose')

const inventorySchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    item: { type: String, required: true },
    meta: { type: String, default: '' },
    sku: { type: String, required: true, unique: true, trim: true },
    category: { type: String, required: true },
    stock: { type: Number, default: 0 },
    capacity: { type: Number, default: 25 },
    price: { type: Number, default: 0 },
    status: { type: String, default: 'Active' },
    serial: { type: String, default: '' },
    supplier: { type: String, default: '' },
    shelfLocation: { type: String, default: '' },
    leadTime: { type: String, default: '' },
    warranty: { type: String, default: '' },
  },
  { timestamps: true }
)

module.exports = mongoose.model('Inventory', inventorySchema)

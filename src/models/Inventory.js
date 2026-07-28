const mongoose = require('mongoose')

const inventorySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, index: true },
    item: { type: String, required: true },
    meta: { type: String, default: '' },
    sku: { type: String, required: true, unique: true, trim: true, index: true },
    category: { type: String, required: true, index: true },
    stock: { type: Number, default: 0 },
    capacity: { type: Number, default: 25 },
    price: { type: Number, default: 0 },
    status: { type: String, default: 'Active', index: true },
    serial: { type: String, default: '' },
    supplier: { type: String, default: '' },
    extractedText: { type: String, default: '' },
    shelfLocation: { type: String, default: '' },
    leadTime: { type: String, default: '' },
    warranty: { type: String, default: '' },
  },
  { timestamps: true }
);

// Compound index for common queries
inventorySchema.index({ status: 1, stock: 1 });

module.exports = mongoose.model('Inventory', inventorySchema)

const mongoose = require('mongoose')

const supplierSchema = new mongoose.Schema(
  {
    ownerKey: { type: String, required: true, trim: true, index: true },
    ownerEmail: { type: String, default: '', lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    contactName: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
    email: { type: String, default: '', lowercase: true, trim: true },
    address: { type: String, default: '', trim: true },
    paymentTerms: { type: String, default: 'Cash', trim: true },
    active: { type: Boolean, default: true, index: true },
    notes: { type: String, default: '', trim: true },
    deliveryPerformance: {
      deliveries: { type: Number, default: 0, min: 0 },
      onTime: { type: Number, default: 0, min: 0 },
      late: { type: Number, default: 0, min: 0 },
      rejectedQuantity: { type: Number, default: 0, min: 0 },
    },
    createdBy: { id: String, username: String, email: String },
    updatedBy: { id: String, username: String, email: String },
  },
  { timestamps: true }
)

supplierSchema.index({ ownerKey: 1, name: 1 }, { unique: true })

module.exports = mongoose.model('Supplier', supplierSchema)

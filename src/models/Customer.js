const mongoose = require('mongoose')

const customerSchema = new mongoose.Schema(
  {
    ownerKey: { type: String, required: true, trim: true, index: true },
    ownerEmail: { type: String, default: '', lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: '', trim: true },
    email: { type: String, default: '', lowercase: true, trim: true },
    address: { type: String, default: '', trim: true },
    paymentStatus: { type: String, default: 'Current', trim: true },
    creditLimit: { type: Number, default: 0, min: 0 },
    paymentTerms: { type: String, default: 'Cash', trim: true },
    active: { type: Boolean, default: true, index: true },
    notes: { type: String, default: '', trim: true },
    createdBy: { id: String, username: String, email: String },
    updatedBy: { id: String, username: String, email: String },
  },
  { timestamps: true }
)

customerSchema.index({ ownerKey: 1, name: 1 }, { unique: true })

module.exports = mongoose.model('Customer', customerSchema)

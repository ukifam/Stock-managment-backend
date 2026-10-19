const mongoose = require('mongoose')

const taxSettingsSchema = new mongoose.Schema(
  {
    taxNumber: { type: String, default: '', trim: true },
    taxRate: { type: Number, default: 0, min: 0 },
    taxInclusive: { type: Boolean, default: false },
  },
  { _id: false }
)

const businessSchema = new mongoose.Schema(
  {
    ownerKey: { type: String, required: true, trim: true },
    ownerEmail: { type: String, default: '', lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    address: { type: String, default: '' },
    phone: { type: String, default: '' },
    email: { type: String, default: '', lowercase: true, trim: true },
    logoUrl: { type: String, default: '' },
    currency: { type: String, default: 'RWF', uppercase: true, trim: true },
    tax: { type: taxSettingsSchema, default: () => ({}) },
    template: { type: String, default: 'other' },
    processingEnabled: { type: Boolean, default: undefined },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
)

businessSchema.index({ ownerKey: 1 }, { unique: true })

module.exports = mongoose.model('Business', businessSchema)

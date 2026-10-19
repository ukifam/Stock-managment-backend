const mongoose = require('mongoose')

const unitConversionSchema = new mongoose.Schema(
  {
    ownerKey: { type: String, required: true, trim: true, index: true },
    ownerEmail: { type: String, default: '', lowercase: true, trim: true },
    productSku: { type: String, default: '', trim: true, uppercase: true, index: true },
    fromUnit: { type: String, required: true, trim: true, lowercase: true },
    toUnit: { type: String, required: true, trim: true, lowercase: true },
    factor: { type: Number, required: true, min: Number.EPSILON },
    description: { type: String, default: '', trim: true },
    active: { type: Boolean, default: true, index: true },
    createdBy: { id: String, username: String, email: String },
    updatedBy: { id: String, username: String, email: String },
  },
  { timestamps: true }
)

unitConversionSchema.index({ ownerKey: 1, productSku: 1, fromUnit: 1, toUnit: 1 }, { unique: true })

module.exports = mongoose.model('UnitConversion', unitConversionSchema)

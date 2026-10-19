const mongoose = require('mongoose')

const criterionSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  minimum: { type: Number, default: null },
  maximum: { type: Number, default: null },
  requiredResult: { type: String, default: '', trim: true },
  unit: { type: String, default: '', trim: true },
}, { _id: false })

const qualityStandardSchema = new mongoose.Schema({
  ownerKey: { type: String, required: true, trim: true, index: true },
  ownerEmail: { type: String, default: '', lowercase: true, trim: true },
  branchCode: { type: String, required: true, trim: true, uppercase: true, index: true },
  createdBy: { id: String, username: String, email: String },
  updatedBy: { id: String, username: String, email: String },
  name: { type: String, required: true, trim: true },
  productSku: { type: String, default: '', trim: true, uppercase: true, index: true },
  processCode: { type: String, default: '', trim: true, uppercase: true, index: true },
  stepSequence: { type: Number, default: null, min: 1 },
  criteria: { type: [criterionSchema], required: true, validate: (entries) => entries.length > 0 },
  active: { type: Boolean, default: true, index: true },
}, { timestamps: true })

qualityStandardSchema.index({ ownerKey: 1, branchCode: 1, active: 1, productSku: 1 })
qualityStandardSchema.index({ ownerKey: 1, branchCode: 1, active: 1, processCode: 1, stepSequence: 1 })

module.exports = mongoose.model('QualityStandard', qualityStandardSchema)

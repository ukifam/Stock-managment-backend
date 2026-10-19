const mongoose = require('mongoose')

const resultSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  unit: { type: String, default: '' },
  passed: { type: Boolean, required: true },
}, { _id: false })

const attachmentSchema = new mongoose.Schema({
  originalName: { type: String, required: true, trim: true },
  storedName: { type: String, required: true, trim: true },
  mimeType: { type: String, required: true, trim: true },
  size: { type: Number, required: true, min: 1 },
  uploadedAt: { type: Date, default: Date.now },
}, { _id: false })

const qualityInspectionSchema = new mongoose.Schema({
  ownerKey: { type: String, required: true, trim: true, index: true },
  ownerEmail: { type: String, default: '', lowercase: true, trim: true },
  branchCode: { type: String, required: true, trim: true, uppercase: true, index: true },
  createdBy: { id: String, username: String, email: String },
  updatedBy: { id: String, username: String, email: String },
  standardId: { type: mongoose.Schema.Types.ObjectId, ref: 'QualityStandard', required: true, index: true },
  inspectionDate: { type: Date, required: true, index: true },
  inspector: { id: String, username: String, email: String },
  productSku: { type: String, required: true, trim: true, uppercase: true, index: true },
  productName: { type: String, required: true, trim: true },
  productionOrderId: { type: String, default: '', trim: true, index: true },
  batchNumber: { type: String, required: true, trim: true, index: true },
  processCode: { type: String, default: '', trim: true, uppercase: true },
  stepSequence: { type: Number, default: null, min: 1 },
  results: { type: [resultSchema], required: true, validate: (entries) => entries.length > 0 },
  outcome: { type: String, enum: ['PASS', 'FAIL', 'ON_HOLD', 'REWORK', 'REJECT'], required: true, index: true },
  notes: { type: String, default: '' },
  attachments: { type: [attachmentSchema], default: [] },
  dispositionApprovedBy: { id: String, username: String, email: String },
  dispositionApprovedAt: { type: Date, default: null },
}, { timestamps: true })

qualityInspectionSchema.index({ ownerKey: 1, branchCode: 1, inspectionDate: -1 })

module.exports = mongoose.model('QualityInspection', qualityInspectionSchema)

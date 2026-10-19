const mongoose = require('mongoose')

const materialSchema = new mongoose.Schema({
  sku: { type: String, required: true, trim: true },
  item: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 0 },
  unit: { type: String, default: 'piece' },
  materialType: { type: String, enum: ['material', 'packaging'], default: 'material' },
  wastePercent: { type: Number, default: 0, min: 0 },
}, { _id: false })

const timedAssignmentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  hoursPerBatch: { type: Number, default: 0, min: 0 },
}, { _id: false })

const utilityAssignmentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  quantityPerBatch: { type: Number, default: 0, min: 0 },
}, { _id: false })

const processStepSchema = new mongoose.Schema({
  sequence: { type: Number, required: true, min: 1 },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  instructions: { type: String, default: '' },
  durationHours: { type: Number, default: 0, min: 0 },
  capacityPerHour: { type: Number, default: 0, min: 0 },
  materials: { type: [materialSchema], default: [] },
  labor: { type: [timedAssignmentSchema], default: [] },
  machines: { type: [timedAssignmentSchema], default: [] },
  utilities: { type: [utilityAssignmentSchema], default: [] },
  expectedOutputQuantity: { type: Number, default: 0, min: 0 },
  expectedWastePercent: { type: Number, default: 0, min: 0 },
  qualityCheck: { type: String, default: '' },
  optional: { type: Boolean, default: false },
  reworkAllowed: { type: Boolean, default: false },
}, { _id: false })

const productionProcessSchema = new mongoose.Schema({
  ownerKey: { type: String, required: true, trim: true, index: true },
  ownerEmail: { type: String, default: '', lowercase: true, trim: true },
  branchCode: { type: String, required: true, trim: true, uppercase: true, index: true },
  createdBy: { id: String, username: String, email: String },
  updatedBy: { id: String, username: String, email: String },
  code: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  steps: { type: [processStepSchema], default: [] },
  active: { type: Boolean, default: true, index: true },
}, { timestamps: true })

productionProcessSchema.index({ ownerKey: 1, branchCode: 1, code: 1 }, { unique: true })

module.exports = mongoose.model('ProductionProcess', productionProcessSchema)

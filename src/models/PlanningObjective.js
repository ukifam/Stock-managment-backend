const mongoose = require('mongoose')

const targetSchema = new mongoose.Schema({
  recipeId: { type: String, required: true },
  productSku: { type: String, required: true },
  productName: { type: String, required: true },
  quantity: { type: Number, required: true, min: 0 },
  unit: { type: String, default: 'piece' },
}, { _id: false })

const planningObjectiveSchema = new mongoose.Schema({
  ownerKey: { type: String, required: true, trim: true, index: true },
  ownerEmail: { type: String, default: '', lowercase: true, trim: true },
  branchCode: { type: String, required: true, trim: true, uppercase: true, index: true },
  createdBy: { id: String, username: String, email: String },
  updatedBy: { id: String, username: String, email: String },
  id: { type: String, required: true, trim: true },
  title: { type: String, required: true, trim: true },
  objective: { type: String, default: '' },
  scheduledDate: { type: String, default: '' },
  targets: { type: [targetSchema], default: [] },
  result: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  status: { type: String, enum: ['DRAFT', 'CALCULATED', 'CONVERTED', 'CANCELLED'], default: 'CALCULATED', index: true },
  convertedOrderIds: { type: [String], default: [] },
}, { timestamps: true })

planningObjectiveSchema.index({ ownerKey: 1, branchCode: 1, id: 1 }, { unique: true })

module.exports = mongoose.model('PlanningObjective', planningObjectiveSchema)

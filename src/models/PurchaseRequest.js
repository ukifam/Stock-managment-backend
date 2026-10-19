const mongoose = require('mongoose')

const purchaseRequestLineSchema = new mongoose.Schema({
  sku: { type: String, required: true, trim: true },
  item: { type: String, required: true, trim: true },
  shortageQuantity: { type: Number, required: true, min: 0 },
  storageUnit: { type: String, default: 'piece' },
  purchaseUnit: { type: String, default: 'piece' },
  purchaseQuantity: { type: Number, required: true, min: 0 },
  packageSize: { type: Number, default: 1, min: 0 },
  packagesRequired: { type: Number, default: 0, min: 0 },
  supplierId: { type: String, default: '' },
  supplierName: { type: String, default: '' },
  estimatedUnitPrice: { type: Number, default: 0, min: 0 },
  estimatedCost: { type: Number, default: 0, min: 0 },
}, { _id: false })

const purchaseRequestSchema = new mongoose.Schema({
  ownerKey: { type: String, required: true, trim: true, index: true },
  ownerEmail: { type: String, default: '', lowercase: true, trim: true },
  branchCode: { type: String, required: true, trim: true, uppercase: true, index: true },
  createdBy: { id: String, username: String, email: String },
  updatedBy: { id: String, username: String, email: String },
  id: { type: String, required: true, trim: true },
  productionOrderId: { type: String, default: '' },
  recipeId: { type: String, default: '' },
  productName: { type: String, default: '' },
  plannedQuantity: { type: Number, default: 0, min: 0 },
  requiredByDate: { type: String, default: '' },
  reason: { type: String, default: '' },
  status: { type: String, enum: ['DRAFT', 'REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'ORDERED'], default: 'REQUESTED', index: true },
  approvedAt: { type: String, default: '' },
  approvedBy: { id: String, username: String, email: String },
  rejectedAt: { type: String, default: '' },
  rejectedBy: { id: String, username: String, email: String },
  rejectionReason: { type: String, default: '' },
  lines: { type: [purchaseRequestLineSchema], default: [] },
  totalEstimatedCost: { type: Number, default: 0, min: 0 },
  notes: { type: String, default: '' },
}, { timestamps: true })

purchaseRequestSchema.index({ ownerKey: 1, branchCode: 1, id: 1 }, { unique: true })

module.exports = mongoose.model('PurchaseRequest', purchaseRequestSchema)

const mongoose = require('mongoose')

const receiptSchema = new mongoose.Schema({
  date: { type: String, required: true },
  sku: { type: String, required: true },
  acceptedQuantity: { type: Number, default: 0, min: 0 },
  damagedQuantity: { type: Number, default: 0, min: 0 },
  rejectedQuantity: { type: Number, default: 0, min: 0 },
  unit: { type: String, default: 'piece' },
  unitPrice: { type: Number, default: 0, min: 0 },
  warehouseCode: { type: String, default: '' },
  batchNumber: { type: String, default: '' },
  expiryDate: { type: String, default: '' },
  receivedBy: { id: String, username: String, email: String },
}, { _id: false })

const lineSchema = new mongoose.Schema({
  sku: { type: String, required: true, trim: true },
  item: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 0 },
  unit: { type: String, default: 'piece' },
  unitPrice: { type: Number, default: 0, min: 0 },
  taxRate: { type: Number, default: 0, min: 0 },
  subtotal: { type: Number, default: 0, min: 0 },
  tax: { type: Number, default: 0, min: 0 },
  total: { type: Number, default: 0, min: 0 },
  receivedQuantity: { type: Number, default: 0, min: 0 },
  damagedQuantity: { type: Number, default: 0, min: 0 },
  rejectedQuantity: { type: Number, default: 0, min: 0 },
}, { _id: false })

const purchaseOrderSchema = new mongoose.Schema({
  ownerKey: { type: String, required: true, trim: true, index: true },
  ownerEmail: { type: String, default: '', lowercase: true, trim: true },
  branchCode: { type: String, required: true, trim: true, uppercase: true, index: true },
  createdBy: { id: String, username: String, email: String },
  updatedBy: { id: String, username: String, email: String },
  id: { type: String, required: true, trim: true },
  purchaseRequestId: { type: String, default: '' },
  supplierId: { type: String, default: '' },
  supplierName: { type: String, required: true, trim: true },
  orderDate: { type: String, required: true },
  expectedDeliveryDate: { type: String, default: '' },
  status: { type: String, enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'], default: 'DRAFT', index: true },
  lines: { type: [lineSchema], default: [] },
  subtotal: { type: Number, default: 0, min: 0 },
  tax: { type: Number, default: 0, min: 0 },
  total: { type: Number, default: 0, min: 0 },
  receipts: { type: [receiptSchema], default: [] },
  notes: { type: String, default: '' },
  approvedAt: { type: String, default: '' },
  approvedBy: { id: String, username: String, email: String },
  receivedAt: { type: String, default: '' },
}, { timestamps: true })

purchaseOrderSchema.index({ ownerKey: 1, branchCode: 1, id: 1 }, { unique: true })

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema)

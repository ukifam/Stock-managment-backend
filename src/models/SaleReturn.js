const mongoose = require('mongoose')

const saleReturnItemSchema = new mongoose.Schema({
  sku: { type: String, required: true, trim: true },
  item: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 0 },
}, { _id: false })

const saleReturnSchema = new mongoose.Schema({
  id: { type: String, required: true, trim: true },
  saleId: { type: String, required: true, trim: true, index: true },
  date: { type: String, required: true },
  ownerKey: { type: String, default: 'legacy', index: true },
  ownerEmail: { type: String, default: 'info@ukifam.com', lowercase: true, trim: true },
  branchCode: { type: String, default: 'MAIN', trim: true, uppercase: true, index: true },
  createdBy: { id: String, username: String, email: String },
  approvedBy: { id: String, username: String, email: String },
  approvedAt: { type: Date },
  rejectedBy: { id: String, username: String, email: String },
  rejectedAt: { type: Date },
  reason: { type: String, required: true, trim: true },
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending', index: true },
  items: { type: [saleReturnItemSchema], required: true },
}, { timestamps: true })

saleReturnSchema.index({ ownerKey: 1, branchCode: 1, id: 1 }, { unique: true })

module.exports = mongoose.model('SaleReturn', saleReturnSchema)

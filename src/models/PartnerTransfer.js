const mongoose = require('mongoose')

const partnerTransferSchema = new mongoose.Schema(
  {
    ownerKey: { type: String, default: 'legacy', index: true },
    ownerEmail: { type: String, default: 'info@ukifam.com', lowercase: true, trim: true },
    branchCode: { type: String, default: 'MAIN', trim: true, uppercase: true, index: true },
    createdBy: { id: String, username: String, email: String },
    updatedBy: { id: String, username: String, email: String },
    reference: { type: String, required: true, trim: true },
    partner: { type: String, required: true, trim: true, index: true },
    partnerPhone: { type: String, default: '' },
    sku: { type: String, default: '', trim: true, index: true },
    item: { type: String, required: true, trim: true, index: true },
    category: { type: String, default: 'General' },
    quantityReceived: { type: Number, required: true, min: 1 },
    quantitySold: { type: Number, default: 0, min: 0 },
    quantityReturned: { type: Number, default: 0, min: 0 },
    partnerUnitCost: { type: Number, required: true, min: 0 },
    customerUnitPrice: { type: Number, required: true, min: 0 },
    receivedDate: { type: String, required: true },
    status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN', index: true },
    notes: { type: String, default: '' },
    sales: [{ saleId: String, customer: String, quantity: Number, unitPrice: Number, date: String }],
    returns: [{ quantity: Number, date: String, notes: String }],
  },
  { timestamps: true }
)

partnerTransferSchema.index({ ownerKey: 1, branchCode: 1, reference: 1 }, { unique: true })
partnerTransferSchema.index({ ownerKey: 1, branchCode: 1, status: 1, receivedDate: -1 })

module.exports = mongoose.model('PartnerTransfer', partnerTransferSchema)

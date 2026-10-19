const mongoose = require('mongoose')

const wasteRecordSchema = new mongoose.Schema(
  {
    ownerKey: { type: String, default: 'legacy', index: true },
    ownerEmail: { type: String, default: 'info@ukifam.com', lowercase: true, trim: true },
    branchCode: { type: String, default: 'MAIN', trim: true, uppercase: true, index: true },
    id: { type: String, required: true, trim: true },
    productionOrderId: { type: String, required: true, index: true },
    productionOrderCode: { type: String, required: true },
    kind: { type: String, enum: ['WASTE', 'BYPRODUCT'], required: true, index: true },
    productSku: { type: String, required: true },
    productName: { type: String, required: true },
    sku: { type: String, default: '' },
    item: { type: String, default: '' },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, default: 'unit' },
    reason: { type: String, default: '' },
    reusable: { type: Boolean, default: false },
    inventorySku: { type: String, default: '' },
    inventoryQuantity: { type: Number, default: 0, min: 0 },
    inventoryUnit: { type: String, default: '' },
    notes: { type: String, default: '' },
    status: { type: String, enum: ['RECORDED', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'REJECTED'], default: 'RECORDED', index: true },
    approvedBy: { id: String, username: String, email: String },
    approvedAt: { type: String, default: '' },
    postedAt: { type: String, default: '' },
    createdBy: { id: String, username: String, email: String },
    updatedBy: { id: String, username: String, email: String },
  },
  { timestamps: true }
)

wasteRecordSchema.index({ ownerKey:  1, branchCode: 1, id: 1 }, { unique: true })
wasteRecordSchema.index({ ownerKey: 1, branchCode: 1, productionOrderId: 1, kind: 1, sku: 1 }, { unique: true })

module.exports = mongoose.model('WasteRecord', wasteRecordSchema)

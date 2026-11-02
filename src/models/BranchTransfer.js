const mongoose = require('mongoose')

const actorSchema = { id: String, username: String, email: String }

const transferItemSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, trim: true },
    item: { type: String, required: true, trim: true },
    category: { type: String, default: 'General' },
    unit: { type: String, default: 'piece' },
    quantity: { type: Number, required: true, min: 0 },
    receivedQuantity: { type: Number, default: 0, min: 0 },
    receivedSku: { type: String, default: '' },
    unitCost: { type: Number, default: 0, min: 0 },
    sellingPrice: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
)

// Stock moved between two branches (shops) of the same business.
const branchTransferSchema = new mongoose.Schema(
  {
    ownerKey: { type: String, required: true, index: true },
    reference: { type: String, required: true, trim: true },
    fromBranch: { type: String, required: true, trim: true, uppercase: true, index: true },
    toBranch: { type: String, required: true, trim: true, uppercase: true, index: true },
    status: { type: String, enum: ['IN_TRANSIT', 'RECEIVING', 'RECEIVED', 'CANCELLED'], default: 'IN_TRANSIT', index: true },
    items: { type: [transferItemSchema], default: [] },
    transporter: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
    receiveNotes: { type: String, default: '', trim: true },
    sentDate: { type: String, required: true },
    expectedDate: { type: String, default: '' },
    receivedDate: { type: String, default: '' },
    sentBy: actorSchema,
    receivedBy: actorSchema,
    cancelledBy: actorSchema,
  },
  { timestamps: true }
)

branchTransferSchema.index({ ownerKey: 1, reference: 1 }, { unique: true })
branchTransferSchema.index({ ownerKey: 1, status: 1, createdAt: -1 })

module.exports = mongoose.model('BranchTransfer', branchTransferSchema)

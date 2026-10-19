const mongoose = require('mongoose')

const warehouseSchema = new mongoose.Schema(
  {
    ownerKey: { type: String, required: true, trim: true, index: true },
    ownerEmail: { type: String, default: '', lowercase: true, trim: true },
    branchCode: { type: String, required: true, trim: true, uppercase: true, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    type: { type: String, default: 'raw_material', trim: true },
    address: { type: String, default: '', trim: true },
    active: { type: Boolean, default: true, index: true },
    createdBy: { id: String, username: String, email: String },
    updatedBy: { id: String, username: String, email: String },
  },
  { timestamps: true }
)

warehouseSchema.index({ ownerKey: 1, branchCode: 1, code: 1 }, { unique: true })

module.exports = mongoose.model('Warehouse', warehouseSchema)

const mongoose = require('mongoose')

const warehouseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    address: { type: String, default: '' },
    active: { type: Boolean, default: true },
  },
  { _id: false }
)

const branchSchema = new mongoose.Schema(
  {
    ownerKey: { type: String, required: true, trim: true, index: true },
    ownerEmail: { type: String, default: '', lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    address: { type: String, default: '' },
    phone: { type: String, default: '' },
    email: { type: String, default: '', lowercase: true, trim: true },
    manager: { type: String, default: '' },
    active: { type: Boolean, default: true, index: true },
    warehouses: { type: [warehouseSchema], default: [] },
  },
  { timestamps: true }
)

branchSchema.index({ ownerKey: 1, code: 1 }, { unique: true })

module.exports = mongoose.model('Branch', branchSchema)

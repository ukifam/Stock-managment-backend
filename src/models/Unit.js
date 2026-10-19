const mongoose = require('mongoose')

const unitSchema = new mongoose.Schema(
  {
    ownerKey: { type: String, required: true, trim: true, index: true },
    ownerEmail: { type: String, default: '', lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, lowercase: true },
    symbol: { type: String, default: '', trim: true },
    category: { type: String, default: 'count', trim: true },
    allowDecimals: { type: Boolean, default: true },
    active: { type: Boolean, default: true, index: true },
    createdBy: { id: String, username: String, email: String },
    updatedBy: { id: String, username: String, email: String },
  },
  { timestamps: true }
)

unitSchema.index({ ownerKey: 1, code: 1 }, { unique: true })

module.exports = mongoose.model('Unit', unitSchema)

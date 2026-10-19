const mongoose = require('mongoose')

const warehouseStockSchema = new mongoose.Schema(
  {
    ownerKey: { type: String, required: true, trim: true, index: true },
    ownerEmail: { type: String, default: '', lowercase: true, trim: true },
    branchCode: { type: String, required: true, trim: true, uppercase: true, index: true },
    warehouseCode: { type: String, required: true, trim: true, uppercase: true, index: true },
    sku: { type: String, required: true, trim: true, uppercase: true, index: true },
    onHand: { type: Number, default: 0 },
    reserved: { type: Number, default: 0, min: 0 },
    incoming: { type: Number, default: 0, min: 0 },
    quarantined: { type: Number, default: 0, min: 0 },
    averageCost: { type: Number, default: 0, min: 0 },
    updatedBy: { id: String, username: String, email: String },
  },
  { timestamps: true }
)

warehouseStockSchema.index({ ownerKey: 1, branchCode: 1, warehouseCode: 1, sku: 1 }, { unique: true })

module.exports = mongoose.model('WarehouseStock', warehouseStockSchema)

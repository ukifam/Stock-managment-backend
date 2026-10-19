const mongoose = require('mongoose')

const stockMovementSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, index: true },
    ownerKey: { type: String, default: 'legacy', index: true },
    ownerEmail: { type: String, default: 'info@ukifam.com', lowercase: true, trim: true },
    branchCode: { type: String, default: 'MAIN', trim: true, uppercase: true, index: true },
    createdBy: { id: String, username: String, email: String },
    updatedBy: { id: String, username: String, email: String },
    sku: { type: String, required: true, index: true },
    type: { 
      type: String, 
      required: true, 
      enum: [
        'PURCHASE', 
        'SALE', 
        'CUSTOMER_RETURN', 
        'SUPPLIER_RETURN', 
        'DAMAGE', 
        'LOSS', 
        'THEFT', 
        'ADJUSTMENT', 
        'PHYSICAL_COUNT',
        'CORRECTION',
        'OPENING_STOCK', 
        'TRANSFER_IN', 
        'TRANSFER_OUT',
        'SHOWCASE_OUT',
        'SHOWCASE_RETURN',
        'SHOWCASE_SALE',
        'PRODUCTION_CONSUMPTION',
        'PRODUCTION_OUTPUT',
        'WASTE',
        'EXPIRY',
        'QUARANTINE',
        'RESERVATION',
        'INCOMING'
      ],
      index: true 
    },
    quantity: { type: Number, required: true },
    originalQuantity: { type: Number, default: 0 },
    originalUnit: { type: String, default: '', trim: true, lowercase: true },
    convertedQuantity: { type: Number, default: 0 },
    convertedUnit: { type: String, default: '', trim: true, lowercase: true },
    warehouseCode: { type: String, default: '', trim: true, uppercase: true, index: true },
    fromWarehouseCode: { type: String, default: '', trim: true, uppercase: true },
    toWarehouseCode: { type: String, default: '', trim: true, uppercase: true },
    batchNumber: { type: String, default: '' },
    expiryDate: { type: String, default: '' },
    serialNumber: { type: String, default: '' },
    previousStock: { type: Number, required: true },
    newStock: { type: Number, required: true },
    reason: { type: String, default: '' },
    reference: { type: String, default: '' },
    partner: { type: String, default: '' },
    showcaseQuantity: { type: Number, default: 0 },
    expectedReturnDate: { type: String, default: '' },
    user: { type: String, default: 'System' }
  },
  { timestamps: true }
)

// Index for getting movements for a specific item ordered by date
stockMovementSchema.index({ ownerKey: 1, branchCode: 1, sku: 1, createdAt: -1 });

module.exports = mongoose.model('StockMovement', stockMovementSchema)

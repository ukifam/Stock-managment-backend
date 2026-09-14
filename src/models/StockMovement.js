const mongoose = require('mongoose')

const stockMovementSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, index: true },
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
        'TRANSFER_OUT'
      ],
      index: true 
    },
    quantity: { type: Number, required: true },
    previousStock: { type: Number, required: true },
    newStock: { type: Number, required: true },
    reason: { type: String, default: '' },
    reference: { type: String, default: '' },
    user: { type: String, default: 'System' }
  },
  { timestamps: true }
)

// Index for getting movements for a specific item ordered by date
stockMovementSchema.index({ sku: 1, createdAt: -1 });

module.exports = mongoose.model('StockMovement', stockMovementSchema)

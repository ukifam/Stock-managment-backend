const mongoose = require('mongoose')

const inventorySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, index: true },
    ownerKey: { type: String, default: 'legacy', index: true },
    ownerEmail: { type: String, default: 'info@ukifam.com', lowercase: true, trim: true },
    branchCode: { type: String, default: 'MAIN', trim: true, uppercase: true, index: true },
    createdBy: { id: String, username: String, email: String },
    updatedBy: { id: String, username: String, email: String },
    item: { type: String, required: true },
    description: { type: String, default: '' },
    meta: { type: String, default: '' },
    sku: { type: String, required: true, trim: true, index: true },
    category: { type: String, required: true, index: true },
    itemType: { type: String, default: 'raw_material', index: true },
    baseUnit: { type: String, default: 'piece', trim: true, lowercase: true },
    stock: { type: Number, default: 0 },
    capacity: { type: Number, default: 25 },
    minimumStock: { type: Number, default: 0 },
    maximumStock: { type: Number, default: 0 },
    reorderLevel: { type: Number, default: 0 },
    price: { type: Number, default: 0 },
    purchasePrice: { type: Number, default: 0 },
    sellingPrice: { type: Number, default: 0 },
    defaultSupplierId: { type: String, default: '' },
    supplierOptions: { type: [{ supplierId: String, supplierName: String, price: Number, purchaseUnit: String, packSize: Number }], default: [] },
    priceTiers: { type: [{ name: String, price: Number }], default: [] },
    defaultWarehouseCode: { type: String, default: '', trim: true, uppercase: true },
    batchTracking: { type: Boolean, default: false },
    expiryTracking: { type: Boolean, default: false },
    serialTracking: { type: Boolean, default: false },
    status: { type: String, default: 'Active', index: true },
    serial: { type: String, default: '' },
    supplier: { type: String, default: '' },
    extractedText: { type: String, default: '' },
    shelfLocation: { type: String, default: '' },
    leadTime: { type: String, default: '' },
    warranty: { type: String, default: '' },
  },
  { timestamps: true }
);

// Compound index for common queries
inventorySchema.index({ status: 1, stock: 1 });
inventorySchema.index({ ownerKey: 1, branchCode: 1, sku: 1 }, { unique: true });

module.exports = mongoose.model('Inventory', inventorySchema)

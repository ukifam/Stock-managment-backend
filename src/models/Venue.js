const mongoose = require('mongoose')

const venueSchema = new mongoose.Schema(
  {
    ownerKey: { type: String, default: 'legacy', index: true },
    ownerEmail: { type: String, default: 'info@ukifam.com', lowercase: true, trim: true },
    name: { type: String, required: true, trim: true, index: true },
    code: { type: String, required: true, trim: true, index: true },
    type: { type: String, default: 'Warehouse', index: true }, // Warehouse, Store, Distribution, Retail
    location: { type: String, default: '' },
    address: { type: String, default: '' },
    capacity: { type: Number, default: 1000 },
    currentItems: { type: Number, default: 0 },
    manager: { type: String, default: '' },
    contact: { type: String, default: '' },
    status: { type: String, default: 'Active', index: true },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
)

// Compound index for common queries
venueSchema.index({ status: 1, type: 1 })
venueSchema.index({ ownerKey: 1, name: 1 }, { unique: true })
venueSchema.index({ ownerKey: 1, code: 1 }, { unique: true })

module.exports = mongoose.model('Venue', venueSchema)

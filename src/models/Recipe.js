const mongoose = require('mongoose')

const materialSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, trim: true },
    item: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, default: 'unit' },
    materialType: { type: String, enum: ['material', 'packaging'], default: 'material' },
    wastePercent: { type: Number, default: 0, min: 0 },
    substitutes: {
      type: [{ sku: String, item: String, quantity: Number, unit: String }],
      default: [],
    },
  },
  { _id: false }
)

const resourceAssignmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    hoursPerBatch: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
)

const utilityAssignmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    quantityPerBatch: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
)

const processStepSchema = new mongoose.Schema(
  {
    sequence: { type: Number, default: 1, min: 1 },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    durationHours: { type: Number, default: 0, min: 0 },
    capacityPerHour: { type: Number, default: 0, min: 0 },
    instructions: { type: String, default: '' },
    qualityCheck: { type: String, default: '' },
    materials: { type: [materialSchema], default: [] },
    labor: { type: [resourceAssignmentSchema], default: [] },
    machines: { type: [resourceAssignmentSchema], default: [] },
    utilities: { type: [utilityAssignmentSchema], default: [] },
    expectedOutputQuantity: { type: Number, default: 0, min: 0 },
    expectedWastePercent: { type: Number, default: 0, min: 0 },
    optional: { type: Boolean, default: false },
    reworkAllowed: { type: Boolean, default: false },
  },
  { _id: false }
)

const recipeSchema = new mongoose.Schema(
  {
    ownerKey: { type: String, default: 'legacy', index: true },
    ownerEmail: { type: String, default: 'info@ukifam.com', lowercase: true, trim: true },
    branchCode: { type: String, default: 'MAIN', trim: true, uppercase: true, index: true },
    createdBy: { id: String, username: String, email: String },
    updatedBy: { id: String, username: String, email: String },
    productSku: { type: String, required: true, trim: true, index: true },
    productName: { type: String, required: true, trim: true },
    productUnit: { type: String, default: 'piece' },
    version: { type: Number, default: 1, min: 1 },
    versionLabel: { type: String, default: '' },
    approvalStatus: { type: String, enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'], default: 'DRAFT', index: true },
    approvedAt: { type: String, default: '' },
    approvedBy: { id: String, username: String, email: String },
    sellingPrice: { type: Number, default: 0, min: 0 },
    yieldQuantity: { type: Number, required: true, min: 0 },
    expectedWastePercent: { type: Number, default: 0, min: 0 },
    materials: { type: [materialSchema], default: [] },
    labor: { type: [resourceAssignmentSchema], default: [] },
    machines: { type: [resourceAssignmentSchema], default: [] },
    utilities: { type: [utilityAssignmentSchema], default: [] },
    processSteps: { type: [processStepSchema], default: [] },
    processId: { type: String, default: '' },
    notes: { type: String, default: '' },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
)

recipeSchema.index({ ownerKey: 1, branchCode: 1, productSku: 1, version: 1 }, { unique: true })

module.exports = mongoose.model('Recipe', recipeSchema)

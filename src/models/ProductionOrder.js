const mongoose = require('mongoose')

const requirementSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, trim: true },
    item: { type: String, required: true, trim: true },
    unit: { type: String, default: 'unit' },
    recipeUnit: { type: String, default: 'unit' },
    purchaseUnit: { type: String, default: '' },
    purchaseQuantity: { type: Number, default: 0 },
    packageSize: { type: Number, default: 1 },
    packagesRequired: { type: Number, default: 0 },
    supplierId: { type: String, default: '' },
    supplierName: { type: String, default: '' },
    onHandQuantity: { type: Number, default: 0 },
    reservedQuantity: { type: Number, default: 0 },
    incomingQuantity: { type: Number, default: 0 },
    projectedAvailableQuantity: { type: Number, default: 0 },
    availabilityStatus: { type: String, default: '' },
    requiredQuantity: { type: Number, required: true, min: 0 },
    availableQuantity: { type: Number, default: 0 },
    shortageQuantity: { type: Number, default: 0 },
    unitCost: { type: Number, default: 0 },
    purchaseUnitPrice: { type: Number, default: 0 },
    purchaseCost: { type: Number, default: 0 },
    materialType: { type: String, enum: ['material', 'packaging'], default: 'material' },
  },
  { _id: false }
)

const costSchema = new mongoose.Schema(
  {
    material: { type: Number, default: 0 },
    packaging: { type: Number, default: 0 },
    labor: { type: Number, default: 0 },
    machine: { type: Number, default: 0 },
    utility: { type: Number, default: 0 },
    overhead: { type: Number, default: 0 },
    transport: { type: Number, default: 0 },
    waste: { type: Number, default: 0 },
    rework: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    unit: { type: Number, default: 0 },
  },
  { _id: false }
)

const actualMaterialSchema = new mongoose.Schema({ sku: String, item: String, quantity: Number, unit: String, unitCost: Number, cost: Number }, { _id: false })
const actualLaborSchema = new mongoose.Schema({ name: String, hours: Number, rate: Number, overtimeHours: Number, cost: Number }, { _id: false })
const actualMachineSchema = new mongoose.Schema({ name: String, hours: Number, quantity: Number, rate: Number, cost: Number }, { _id: false })
const actualUtilitySchema = new mongoose.Schema({ name: String, quantity: Number, unit: String, rate: Number, cost: Number }, { _id: false })
const byProductSchema = new mongoose.Schema({ sku: String, item: String, quantity: Number, unit: String, notes: String }, { _id: false })
const reservationSchema = new mongoose.Schema({ sku: String, warehouseCode: String, quantity: Number, unit: String, reservedAt: String }, { _id: false })

const qualityInspectionSchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    result: { type: String, enum: ['PASS', 'FAIL', 'ON_HOLD', 'REWORK', 'REJECT'], required: true },
    notes: { type: String, default: '' },
    inspectedBy: { type: String, default: 'System' },
  },
  { _id: false, timestamps: true }
)

const productionOrderSchema = new mongoose.Schema(
  {
    ownerKey: { type: String, default: 'legacy', index: true },
    ownerEmail: { type: String, default: 'info@ukifam.com', lowercase: true, trim: true },
    branchCode: { type: String, default: 'MAIN', trim: true, uppercase: true, index: true },
    createdBy: { id: String, username: String, email: String },
    updatedBy: { id: String, username: String, email: String },
    id: { type: String, required: true, trim: true, index: true },
    recipeId: { type: String, required: true },
    recipeVersion: { type: Number, default: 1 },
    productSku: { type: String, required: true, trim: true, index: true },
    productName: { type: String, required: true, trim: true },
    productUnit: { type: String, default: 'piece' },
    plannedQuantity: { type: Number, required: true, min: 0 },
    actualOutput: { type: Number, default: 0, min: 0 },
    originalActualOutput: { type: Number, default: 0, min: 0 },
    actualWaste: { type: Number, default: 0, min: 0 },
    actualWastePercent: { type: Number, default: 0, min: 0 },
    expectedWasteQuantity: { type: Number, default: 0, min: 0 },
    expectedWastePercent: { type: Number, default: 0, min: 0 },
    totalMaterialInputQuantity: { type: Number, default: 0, min: 0 },
    actualWasteReason: { type: String, default: '' },
    status: {
      type: String,
      enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PLANNED', 'MATERIALS_READY', 'IN_PROGRESS', 'PAUSED', 'QUALITY_CHECK', 'REWORK', 'COMPLETED', 'ON_HOLD', 'REJECTED', 'CANCELLED'],
      default: 'DRAFT',
      index: true,
    },
    scheduledDate: { type: String, required: true, index: true },
    plannedEndDate: { type: String, default: '' },
    approvedAt: { type: String, default: '' },
    approvedBy: { id: String, username: String, email: String },
    expectedDurationHours: { type: Number, default: 0 },
    warehouseCode: { type: String, default: '' },
    startedAt: { type: String, default: '' },
    pausedAt: { type: String, default: '' },
    productionTimeHours: { type: Number, default: 0 },
    materialReservations: { type: [reservationSchema], default: [] },
    requirements: { type: [requirementSchema], default: [] },
    planningAssumptions: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    scheduleWarnings: { type: [String], default: [] },
    cost: { type: costSchema, default: () => ({}) },
    actualMaterials: { type: [actualMaterialSchema], default: [] },
    actualLabor: { type: [actualLaborSchema], default: [] },
    actualMachines: { type: [actualMachineSchema], default: [] },
    actualUtilities: { type: [actualUtilitySchema], default: [] },
    byProducts: { type: [byProductSchema], default: [] },
    actualCost: { type: costSchema, default: () => ({}) },
    costVariance: { type: costSchema, default: () => ({}) },
    qualityInspections: { type: [qualityInspectionSchema], default: [] },
    notes: { type: String, default: '' },
    completedAt: { type: String, default: '' },
  },
  { timestamps: true }
)

productionOrderSchema.index({ ownerKey: 1, branchCode: 1, id: 1 }, { unique: true })
productionOrderSchema.index({ ownerKey: 1, branchCode: 1, status: 1, scheduledDate: -1 })

module.exports = mongoose.model('ProductionOrder', productionOrderSchema)

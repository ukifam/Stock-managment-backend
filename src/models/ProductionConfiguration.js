const mongoose = require('mongoose')

const conversionSchema = new mongoose.Schema(
  {
    fromUnit: { type: String, required: true, trim: true },
    toUnit: { type: String, required: true, trim: true },
    factor: { type: Number, required: true, min: 0 },
  },
  { _id: false }
)

const workerSchema = new mongoose.Schema(
  {
    code: { type: String, default: '' },
    name: { type: String, required: true, trim: true },
    role: { type: String, default: '' },
    skills: { type: [String], default: [] },
    rateType: { type: String, enum: ['monthly', 'daily', 'hourly', 'per_product', 'per_batch'], default: 'hourly' },
    rate: { type: Number, default: 0, min: 0 },
    hourlyRate: { type: Number, default: 0, min: 0 },
    overtimeRate: { type: Number, default: 0, min: 0 },
    availableHoursPerDay: { type: Number, default: 8, min: 0 },
    active: { type: Boolean, default: true },
  },
  { _id: false }
)

const machineSchema = new mongoose.Schema(
  {
    code: { type: String, default: '' },
    name: { type: String, required: true, trim: true },
    machineType: { type: String, default: '' },
    purchasePrice: { type: Number, default: 0, min: 0 },
    purchaseDate: { type: String, default: '' },
    usefulLifeYears: { type: Number, default: 0, min: 0 },
    residualValue: { type: Number, default: 0, min: 0 },
    capacityUnit: { type: String, default: 'unit' },
    hourlyRate: { type: Number, default: 0, min: 0 },
    rate: { type: Number, default: 0, min: 0 },
    costingMethod: { type: String, enum: ['hourly', 'quantity', 'batch', 'depreciation'], default: 'hourly' },
    capacityPerHour: { type: Number, default: 0, min: 0 },
    electricityPerHour: { type: Number, default: 0, min: 0 },
    fuelPerHour: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['Available', 'In Use', 'Maintenance', 'Broken', 'Retired'], default: 'Available' },
    operatingHours: { type: Number, default: 0, min: 0 },
    maintenanceIntervalHours: { type: Number, default: 0, min: 0 },
    lastMaintenanceHours: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
)

const utilitySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    unit: { type: String, default: 'unit' },
    rate: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
)

const overheadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    amount: { type: Number, default: 0, min: 0 },
    allocationMethod: { type: String, enum: ['per_unit', 'per_batch', 'per_production_hour', 'percentage', 'fixed'], default: 'per_unit' },
    active: { type: Boolean, default: true },
  },
  { _id: false }
)

const productionConfigurationSchema = new mongoose.Schema(
  {
    ownerKey: { type: String, default: 'legacy', index: true },
    ownerEmail: { type: String, default: 'info@ukifam.com', lowercase: true, trim: true },
    branchCode: { type: String, default: 'MAIN', trim: true, uppercase: true, index: true },
    createdBy: { id: String, username: String, email: String },
    updatedBy: { id: String, username: String, email: String },
    units: { type: [String], default: ['piece', 'kg', 'litre', 'hour', 'batch'] },
    conversions: { type: [conversionSchema], default: [] },
    workers: { type: [workerSchema], default: [] },
    machines: { type: [machineSchema], default: [] },
    utilities: { type: [utilitySchema], default: [] },
    overheadCosts: { type: [overheadSchema], default: [] },
    overheadRatePerUnit: { type: Number, default: 0, min: 0 },
    transportCostPerBatch: { type: Number, default: 0, min: 0 },
    separationOfDuties: { type: Boolean, default: false },
  },
  { timestamps: true }
)

productionConfigurationSchema.index({ ownerKey: 1, branchCode: 1 }, { unique: true })

module.exports = mongoose.model('ProductionConfiguration', productionConfigurationSchema)

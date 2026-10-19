const mongoose = require('mongoose')

const ingredientSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  quantity: { type: Number, default: 1 },
  unit: { type: String, default: 'unit' },
  unitCost: { type: Number, default: 0 },
}, { _id: false })

const totalIngredientSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  quantity: { type: Number, default: 1 },
  unit: { type: String, default: 'unit' },
  unitCost: { type: Number, default: 0 },
  totalQuantity: { type: Number, default: 0 },
  totalCost: { type: Number, default: 0 },
}, { _id: false })

const purchasedItemSchema = new mongoose.Schema({
  ingredientId: { type: String, required: true },
  purchased: { type: Boolean, default: false },
  purchasedQuantity: { type: Number, default: 0 },
  actualCost: { type: Number, default: 0 },
  surplusQuantity: { type: Number, default: 0 },
}, { _id: false })

const qualityResultSchema = new mongoose.Schema({
  passed: { type: Boolean, default: false },
  inspectedQuantity: { type: Number, default: 0 },
  passedQuantity: { type: Number, default: 0 },
  defectQuantity: { type: Number, default: 0 },
  notes: { type: String, default: '' },
  inspectedBy: { type: String, default: '' },
  date: { type: String, default: '' },
}, { _id: false })

const saleRecordSchema = new mongoose.Schema({
  id: { type: String, required: true },
  date: { type: String, default: '' },
  quantity: { type: Number, default: 0 },
  unitPrice: { type: Number, default: 0 },
  customer: { type: String, default: 'Walk-in' },
  payment: { type: String, default: 'Cash' },
}, { _id: false })

const activityLogSchema = new mongoose.Schema({
  id: { type: String, required: true },
  stage: { type: String, required: true },
  stageLabel: { type: String, default: '' },
  performedBy: { type: String, default: '' },
  performedByRole: { type: String, default: '' },
  timestamp: { type: String, default: '' },
  summary: { type: String, default: '' },
  details: { type: String, default: '' },
  metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { _id: false })

const pipelineSchema = new mongoose.Schema({
  ownerKey: { type: String, default: 'legacy', index: true },
  ownerEmail: { type: String, default: '', lowercase: true, trim: true },
  branchCode: { type: String, default: 'MAIN', trim: true, uppercase: true, index: true },
  createdBy: { id: String, username: String, email: String },
  updatedBy: { id: String, username: String, email: String },

  id: { type: String, required: true, trim: true, index: true },
  productName: { type: String, default: '' },
  businessType: { type: String, default: '' },
  singleUnitLabel: { type: String, default: 'unit' },
  ingredients: { type: [ingredientSchema], default: [] },
  targetQuantity: { type: Number, default: 1 },
  scheduledDate: { type: String, default: '' },
  currentStage: { type: String, default: 'plan' },
  completedStages: { type: [String], default: [] },
  executionMode: { type: String, default: 'delegated' },
  activityLog: { type: [activityLogSchema], default: [] },
  totalIngredients: { type: [totalIngredientSchema], default: [] },
  totalMaterialCost: { type: Number, default: 0 },
  purchasedItems: { type: [purchasedItemSchema], default: [] },
  producedQuantity: { type: Number, default: 0 },
  productionStartTime: { type: String, default: '' },
  productionEndTime: { type: String, default: '' },
  productionNotes: { type: String, default: '' },
  qualityResult: { type: qualityResultSchema, default: null },
  sellingPricePerUnit: { type: Number, default: 0 },
  sales: { type: [saleRecordSchema], default: [] },
  rawMaterialsStored: { type: Boolean, default: false },
  finishedGoodsStored: { type: Boolean, default: false },
  finishedGoodsLocation: { type: String, default: '' },
  createdAt: { type: String, default: '' },
  updatedAt: { type: String, default: '' },
}, { timestamps: true })

pipelineSchema.index({ ownerKey: 1, branchCode: 1, id: 1 }, { unique: true })
pipelineSchema.index({ ownerKey: 1, branchCode: 1, productName: 1 })

module.exports = mongoose.model('Pipeline', pipelineSchema)

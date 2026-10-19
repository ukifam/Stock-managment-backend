const Supplier = require('../models/Supplier')
const Customer = require('../models/Customer')
const storeModel = require('../models/storeModel')
const inventoryService = require('./inventoryService')
const unitConversionService = require('./unitConversionService')
const warehouseStockService = require('./warehouseStockService')
const httpError = require('../utils/httpError')
const { auditActor, currentTenant } = require('../utils/tenantContext')

async function getMasterData() {
  const tenant = requireTenant()
  const [units, conversions, suppliers, customers, warehouses, stock, expiryAlerts, store] = await Promise.all([
    unitConversionService.listUnits(),
    unitConversionService.listConversions(),
    listSuppliers(),
    listCustomers(),
    warehouseStockService.listWarehouses(),
    warehouseStockService.listBalances(),
    warehouseStockService.listExpiryAlerts(),
    storeModel.readStore(),
  ])
  return {
    units,
    conversions,
    suppliers,
    customers,
    warehouses,
    stock,
    expiryAlerts,
    items: store.inventory.map(serializeItem),
    ownerKey: tenant.ownerKey,
  }
}

async function listSuppliers() {
  const tenant = requireTenant()
  return Supplier.find({ ownerKey: tenant.ownerKey }).sort({ active: -1, name: 1 }).lean()
}

async function createSupplier(payload = {}) {
  const tenant = requireTenant()
  const supplier = normalizeSupplier(payload)
  try {
    const created = await Supplier.create({
      ...supplier,
      ownerKey: tenant.ownerKey,
      ownerEmail: tenant.ownerEmail,
      createdBy: auditActor(),
      updatedBy: auditActor(),
    })
    return created.toObject()
  } catch (error) {
    if (error?.code === 11000) throw httpError(409, 'A supplier with this name already exists')
    throw error
  }
}

async function updateSupplier(id, payload = {}) {
  const tenant = requireTenant()
  const supplier = await Supplier.findOne({ ownerKey: tenant.ownerKey, _id: id })
  if (!supplier) throw httpError(404, 'Supplier not found')
  Object.assign(supplier, normalizeSupplier({ ...supplier.toObject(), ...payload }, supplier.toObject()), { updatedBy: auditActor() })
  try {
    await supplier.save()
  } catch (error) {
    if (error?.code === 11000) throw httpError(409, 'A supplier with this name already exists')
    throw error
  }
  return supplier.toObject()
}

async function listCustomers() {
  const tenant = requireTenant()
  return Customer.find({ ownerKey: tenant.ownerKey }).sort({ active: -1, name: 1 }).lean()
}

async function createCustomer(payload = {}) {
  const tenant = requireTenant()
  const customer = normalizeCustomer(payload)
  try {
    const created = await Customer.create({
      ...customer,
      ownerKey: tenant.ownerKey,
      ownerEmail: tenant.ownerEmail,
      createdBy: auditActor(),
      updatedBy: auditActor(),
    })
    return created.toObject()
  } catch (error) {
    if (error?.code === 11000) throw httpError(409, 'A customer with this name already exists')
    throw error
  }
}

async function updateCustomer(id, payload = {}) {
  const tenant = requireTenant()
  const customer = await Customer.findOne({ ownerKey: tenant.ownerKey, _id: id })
  if (!customer) throw httpError(404, 'Customer not found')
  Object.assign(customer, normalizeCustomer({ ...customer.toObject(), ...payload }, customer.toObject()), { updatedBy: auditActor() })
  try {
    await customer.save()
  } catch (error) {
    if (error?.code === 11000) throw httpError(409, 'A customer with this name already exists')
    throw error
  }
  return customer.toObject()
}

async function createItem(payload = {}) {
  const item = await normalizeItemPayload(payload)
  return inventoryService.createInventoryItem({ ...item, stock: payload.stock ?? 0 })
}

async function updateItem(sku, payload = {}) {
  const item = await normalizeItemPayload(payload, true)
  return inventoryService.updateInventoryItem(sku, item)
}

async function normalizeItemPayload(payload = {}, partial = false) {
  const result = { ...payload }
  if (!partial || payload.baseUnit !== undefined) {
    result.baseUnit = unitConversionService.normalizeUnitCode(payload.baseUnit || 'piece')
    await unitConversionService.assertUnitExists(result.baseUnit)
  }
  if (!partial || payload.itemType !== undefined) {
    result.itemType = normalizeItemType(payload.itemType || 'raw_material')
  }
  if (!partial || payload.supplierOptions !== undefined) {
    result.supplierOptions = normalizeSupplierOptions(payload.supplierOptions)
  }
  for (const field of ['minimumStock', 'maximumStock', 'reorderLevel', 'purchasePrice', 'sellingPrice']) {
    if (result[field] !== undefined) {
      const value = Number(result[field])
      if (!Number.isFinite(value) || value < 0) throw httpError(400, `${field} must be a non-negative number`)
      result[field] = value
    }
  }
  if (result.maximumStock !== undefined) result.capacity = result.maximumStock
  if (result.sellingPrice !== undefined) result.price = result.sellingPrice
  return result
}

function serializeItem(item) {
  return {
    id: String(item._id || ''),
    sku: item.sku,
    item: item.item,
    description: item.description || '',
    category: item.category,
    itemType: item.itemType || 'raw_material',
    baseUnit: item.baseUnit || 'piece',
    status: item.status || 'Active',
    stock: Number(item.stock || 0),
    minimumStock: Number(item.minimumStock || 0),
    maximumStock: Number(item.maximumStock || item.capacity || 0),
    reorderLevel: Number(item.reorderLevel || 0),
    defaultSupplierId: item.defaultSupplierId || '',
    supplierOptions: item.supplierOptions || [],
    purchasePrice: Number(item.purchasePrice ?? item.price ?? 0),
    sellingPrice: Number(item.sellingPrice ?? item.price ?? 0),
    priceTiers: item.priceTiers || [],
    defaultWarehouseCode: item.defaultWarehouseCode || '',
    batchTracking: Boolean(item.batchTracking),
    expiryTracking: Boolean(item.expiryTracking),
    serialTracking: Boolean(item.serialTracking),
  }
}

function normalizeSupplier(payload = {}, fallback = {}) {
  const name = String(payload.name ?? fallback.name ?? '').trim()
  if (!name) throw httpError(400, 'Supplier name is required')
  return {
    name,
    contactName: String(payload.contactName ?? fallback.contactName ?? '').trim(),
    phone: String(payload.phone ?? fallback.phone ?? '').trim(),
    email: String(payload.email ?? fallback.email ?? '').trim().toLowerCase(),
    address: String(payload.address ?? fallback.address ?? '').trim(),
    paymentTerms: String(payload.paymentTerms ?? fallback.paymentTerms ?? 'Cash').trim(),
    active: payload.active === undefined ? fallback.active !== false : Boolean(payload.active),
    notes: String(payload.notes ?? fallback.notes ?? '').trim(),
  }
}

function normalizeCustomer(payload = {}, fallback = {}) {
  const name = String(payload.name ?? fallback.name ?? '').trim()
  if (!name) throw httpError(400, 'Customer name is required')
  const creditLimit = Number(payload.creditLimit ?? fallback.creditLimit ?? 0)
  if (!Number.isFinite(creditLimit) || creditLimit < 0) throw httpError(400, 'Credit limit must be a non-negative number')
  return {
    name,
    phone: String(payload.phone ?? fallback.phone ?? '').trim(),
    email: String(payload.email ?? fallback.email ?? '').trim().toLowerCase(),
    address: String(payload.address ?? fallback.address ?? '').trim(),
    paymentStatus: String(payload.paymentStatus ?? fallback.paymentStatus ?? 'Current').trim(),
    creditLimit,
    paymentTerms: String(payload.paymentTerms ?? fallback.paymentTerms ?? 'Cash').trim(),
    active: payload.active === undefined ? fallback.active !== false : Boolean(payload.active),
    notes: String(payload.notes ?? fallback.notes ?? '').trim(),
  }
}

function normalizeSupplierOptions(value) {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const price = Number(entry?.price || 0)
    if (!Number.isFinite(price) || price < 0) throw httpError(400, 'Supplier price must be a non-negative number')
    return {
      supplierId: String(entry?.supplierId || '').trim(),
      supplierName: String(entry?.supplierName || '').trim(),
      price,
      purchaseUnit: unitConversionService.normalizeUnitCode(entry?.purchaseUnit || 'piece'),
      packSize: normalizePackSize(entry?.packSize),
    }
  }).filter((entry) => entry.supplierId || entry.supplierName)
}

function normalizePackSize(value) {
  const size = Number(value ?? 1)
  if (!Number.isFinite(size) || size <= 0) throw httpError(400, 'Supplier package size must be greater than zero')
  return size
}

function normalizeItemType(value) {
  const type = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  const allowed = ['raw_material', 'packaging_material', 'consumable', 'finished_product', 'semi_finished_product', 'by_product']
  if (!allowed.includes(type)) throw httpError(400, 'Choose a valid item type')
  return type
}

function requireTenant() {
  const tenant = currentTenant()
  if (!tenant.ownerKey) throw httpError(403, 'Select a business before managing master data')
  return tenant
}

module.exports = {
  createCustomer,
  createItem,
  createSupplier,
  getMasterData,
  listCustomers,
  listSuppliers,
  serializeItem,
  updateCustomer,
  updateItem,
  updateSupplier,
}

const Warehouse = require('../models/Warehouse')
const WarehouseStock = require('../models/WarehouseStock')
const storeModel = require('../models/storeModel')
const httpError = require('../utils/httpError')
const { auditActor, currentBranchCode, currentTenant } = require('../utils/tenantContext')
const { convertItemQuantity, normalizeUnitCode } = require('./unitConversionService')

const DEFAULT_WAREHOUSE_CODE = 'MAIN-STORAGE'
const WAREHOUSE_TYPES = new Set(['raw_material', 'packaging', 'finished_goods', 'quarantine', 'waste', 'general'])

async function ensureDefaultWarehouse() {
  const tenant = requireTenant()
  const branchCode = currentBranchCode()
  const warehouse = await Warehouse.findOneAndUpdate(
    { ownerKey: tenant.ownerKey, branchCode, code: DEFAULT_WAREHOUSE_CODE },
    {
      $setOnInsert: {
        ownerKey: tenant.ownerKey,
        ownerEmail: tenant.ownerEmail,
        branchCode,
        code: DEFAULT_WAREHOUSE_CODE,
        name: 'Main Storage',
        type: 'general',
        active: true,
        createdBy: auditActor(),
        updatedBy: auditActor(),
      },
    },
    { upsert: true, returnDocument: 'after' }
  )
  return warehouse
}

async function listWarehouses() {
  const tenant = requireTenant()
  await ensureDefaultWarehouse()
  return Warehouse.find({ ownerKey: tenant.ownerKey, branchCode: currentBranchCode() }).sort({ active: -1, name: 1 }).lean()
}

async function createWarehouse(payload = {}) {
  const tenant = requireTenant()
  const warehouse = normalizeWarehouse(payload)
  const branchCode = currentBranchCode()
  if (await Warehouse.findOne({ ownerKey: tenant.ownerKey, branchCode, code: warehouse.code }).lean()) {
    throw httpError(409, 'A warehouse with this code already exists for this branch')
  }
  const created = await Warehouse.create({
    ...warehouse,
    ownerKey: tenant.ownerKey,
    ownerEmail: tenant.ownerEmail,
    branchCode,
    createdBy: auditActor(),
    updatedBy: auditActor(),
  })
  return created.toObject()
}

async function updateWarehouse(code, payload = {}) {
  const tenant = requireTenant()
  const warehouse = await Warehouse.findOne({ ownerKey: tenant.ownerKey, branchCode: currentBranchCode(), code: normalizeWarehouseCode(code) })
  if (!warehouse) throw httpError(404, 'Warehouse not found')
  const next = normalizeWarehouse({ ...warehouse.toObject(), ...payload }, warehouse.toObject())
  if (next.code !== warehouse.code) throw httpError(400, 'A warehouse code cannot be changed after creation')
  Object.assign(warehouse, next, { updatedBy: auditActor() })
  await warehouse.save()
  return warehouse.toObject()
}

async function listBalances() {
  const tenant = requireTenant()
  const [store, warehouses, balances] = await Promise.all([
    storeModel.readStore(),
    listWarehouses(),
    WarehouseStock.find({ ownerKey: tenant.ownerKey, branchCode: currentBranchCode() }).lean(),
  ])
  const balanceMap = new Map(balances.map((balance) => [`${balance.warehouseCode}:${balance.sku}`, balance]))
  const defaultWarehouse = warehouses.find((warehouse) => warehouse.code === DEFAULT_WAREHOUSE_CODE)
  return warehouses.flatMap((warehouse) => store.inventory.map((item) => {
    const found = balanceMap.get(`${warehouse.code}:${item.sku}`)
    const onHand = found ? Number(found.onHand || 0) : (warehouse.code === defaultWarehouse?.code ? Number(item.stock || 0) : 0)
    const reserved = Number(found?.reserved || 0)
    const incoming = Number(found?.incoming || 0)
    const quarantined = Number(found?.quarantined || 0)
    return {
      warehouseCode: warehouse.code,
      warehouseName: warehouse.name,
      warehouseType: warehouse.type,
      sku: item.sku,
      item: item.item,
      baseUnit: item.baseUnit || 'piece',
      onHand: round(onHand),
      reserved: round(reserved),
      available: round(Math.max(0, onHand - reserved)),
      incoming: round(incoming),
      quarantined: round(quarantined),
      averageCost: Number(found?.averageCost ?? item.purchasePrice ?? item.price ?? 0),
    }
  }))
}

async function listExpiryAlerts(days = 30) {
  const tenant = requireTenant()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() + Math.max(1, Number(days) || 30))
  const cutoffDate = cutoff.toISOString().slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  const [movements, store] = await Promise.all([
    storeModel.StockMovement.find(storeModel.branchScopedQuery({
      expiryDate: { $ne: '', $lte: cutoffDate },
      type: { $in: ['PURCHASE', 'OPENING_STOCK', 'CUSTOMER_RETURN', 'TRANSFER_IN'] },
    })).sort({ expiryDate: 1, createdAt: -1 }).lean(),
    storeModel.readStore(),
  ])
  const itemNames = new Map(store.inventory.map((item) => [item.sku, item.item]))
  return movements.map((movement) => ({
    sku: movement.sku,
    item: itemNames.get(movement.sku) || movement.sku,
    warehouseCode: movement.warehouseCode || DEFAULT_WAREHOUSE_CODE,
    batchNumber: movement.batchNumber || '',
    expiryDate: movement.expiryDate,
    quantity: Number(movement.convertedQuantity || Math.abs(movement.quantity || 0)),
    status: movement.expiryDate < today ? 'Expired' : 'Due soon',
  }))
}

async function recordStockOperation(payload = {}) {
  const operation = String(payload.operation || '').trim().toUpperCase()
  const store = await storeModel.readStore()
  const itemIndex = store.inventory.findIndex((item) => item.sku === String(payload.sku || '').trim())
  if (itemIndex === -1) throw httpError(404, 'Inventory item not found')
  const item = store.inventory[itemIndex]
  const sourceUnit = normalizeUnitCode(payload.unit || item.baseUnit || 'piece')
  const inputQuantity = Number(payload.quantity)
  if (!Number.isFinite(inputQuantity) || inputQuantity <= 0) throw httpError(400, 'Quantity must be a positive number')
  const conversion = await convertItemQuantity(item, inputQuantity, sourceUnit)
  const quantity = conversion.quantity
  const date = payload.date || new Date().toISOString().slice(0, 10)
  const warehouse = operation === 'QUARANTINE_RECEIPT'
    ? await ensureQuarantineWarehouse()
    : await findWarehouse(payload.warehouseCode || item.defaultWarehouseCode)
  const reason = String(payload.reason || '').trim()

  if (operation === 'RECEIPT' || operation === 'CUSTOMER_RETURN' || operation === 'PRODUCTION_OUTPUT') {
    const balance = await getBalance(warehouse, item, Number(item.stock || 0))
    balance.onHand = round(Number(balance.onHand || 0) + quantity)
    balance.incoming = round(Math.max(0, Number(balance.incoming || 0) - quantity))
    balance.averageCost = resolveAverageCost(balance, item, quantity, Number(payload.unitPrice ?? item.purchasePrice ?? item.price ?? 0))
    balance.updatedBy = auditActor()
    await balance.save()
    updateItemStock(item, quantity)
    store.inventory[itemIndex] = item
    await storeModel.writeStore(store)
    return createMovement({
      date, item, type: operation === 'CUSTOMER_RETURN' ? 'CUSTOMER_RETURN' : operation === 'PRODUCTION_OUTPUT' ? 'PRODUCTION_OUTPUT' : 'PURCHASE', quantity, previousStock: Number(item.stock || 0) - quantity, newStock: Number(item.stock || 0),
      originalQuantity: inputQuantity, originalUnit: sourceUnit, convertedQuantity: quantity, convertedUnit: item.baseUnit || sourceUnit,
      warehouseCode: warehouse.code, reason: reason || (operation === 'CUSTOMER_RETURN' ? 'Customer return received' : operation === 'PRODUCTION_OUTPUT' ? 'Production output' : 'Stock receipt'), reference: payload.reference, partner: payload.partner,
      batchNumber: payload.batchNumber, expiryDate: payload.expiryDate, serialNumber: payload.serialNumber,
    })
  }

  if (operation === 'TRANSFER') {
    const source = await findWarehouse(payload.fromWarehouseCode || payload.warehouseCode || item.defaultWarehouseCode)
    const target = await findWarehouse(payload.toWarehouseCode)
    if (source.code === target.code) throw httpError(400, 'Choose two different warehouses for a transfer')
    const sourceBalance = await getBalance(source, item, source.code === DEFAULT_WAREHOUSE_CODE ? Number(item.stock || 0) : 0)
    if (quantity > availableQuantity(sourceBalance)) throw httpError(400, `Only ${availableQuantity(sourceBalance)} ${item.baseUnit || 'units'} are available in ${source.name}`)
    const targetBalance = await getBalance(target, item, 0)
    sourceBalance.onHand = round(Number(sourceBalance.onHand || 0) - quantity)
    targetBalance.onHand = round(Number(targetBalance.onHand || 0) + quantity)
    sourceBalance.updatedBy = auditActor()
    targetBalance.updatedBy = auditActor()
    await Promise.all([sourceBalance.save(), targetBalance.save()])
    const previousStock = Number(item.stock || 0)
    const common = {
      date, item, originalQuantity: inputQuantity, originalUnit: sourceUnit, convertedQuantity: quantity, convertedUnit: item.baseUnit || sourceUnit,
      previousStock, newStock: previousStock, reason: reason || `Transfer from ${source.name} to ${target.name}`, reference: payload.reference,
      fromWarehouseCode: source.code, toWarehouseCode: target.code,
    }
    const [outgoing, incoming] = await Promise.all([
      createMovement({ ...common, type: 'TRANSFER_OUT', quantity: -quantity, warehouseCode: source.code }),
      createMovement({ ...common, type: 'TRANSFER_IN', quantity, warehouseCode: target.code }),
    ])
    return { outgoing, incoming }
  }

  if (operation === 'COUNT') {
    const balance = await getBalance(warehouse, item, warehouse.code === DEFAULT_WAREHOUSE_CODE ? Number(item.stock || 0) : 0)
    const delta = round(quantity - Number(balance.onHand || 0))
    if (delta === 0) throw httpError(400, 'The physical count matches the recorded balance')
    balance.onHand = quantity
    balance.updatedBy = auditActor()
    await balance.save()
    updateItemStock(item, delta)
    store.inventory[itemIndex] = item
    await storeModel.writeStore(store)
    return createMovement({
      date, item, type: 'PHYSICAL_COUNT', quantity: delta, previousStock: Number(item.stock || 0) - delta, newStock: Number(item.stock || 0),
      originalQuantity: inputQuantity, originalUnit: sourceUnit, convertedQuantity: quantity, convertedUnit: item.baseUnit || sourceUnit,
      warehouseCode: warehouse.code, reason: reason || 'Physical stock count', reference: payload.reference,
    })
  }

  if (operation === 'QUARANTINE_RECEIPT') {
    const balance = await getBalance(warehouse, item, 0)
    balance.quarantined = round(Number(balance.quarantined || 0) + quantity)
    balance.updatedBy = auditActor()
    await balance.save()
    const previousStock = Number(item.stock || 0)
    return createMovement({
      date, item, type: 'QUARANTINE', quantity: 0, previousStock, newStock: previousStock,
      originalQuantity: inputQuantity, originalUnit: sourceUnit, convertedQuantity: quantity, convertedUnit: item.baseUnit || sourceUnit,
      warehouseCode: warehouse.code, batchNumber: payload.batchNumber,
      reason: reason || 'Failed production output placed in quarantine', reference: payload.reference,
    })
  }

  if (operation === 'QUARANTINE' || operation === 'RELEASE_QUARANTINE') {
    const balance = await getBalance(warehouse, item, warehouse.code === DEFAULT_WAREHOUSE_CODE ? Number(item.stock || 0) : 0)
    if (operation === 'QUARANTINE') {
      if (quantity > availableQuantity(balance)) throw httpError(400, 'Insufficient available stock to quarantine')
      balance.onHand = round(Number(balance.onHand || 0) - quantity)
      balance.quarantined = round(Number(balance.quarantined || 0) + quantity)
    } else {
      if (quantity > Number(balance.quarantined || 0)) throw httpError(400, 'Insufficient quarantined stock to release')
      balance.quarantined = round(Number(balance.quarantined || 0) - quantity)
      balance.onHand = round(Number(balance.onHand || 0) + quantity)
    }
    balance.updatedBy = auditActor()
    await balance.save()
    const previousStock = Number(item.stock || 0)
    return createMovement({
      date, item, type: 'QUARANTINE', quantity: 0, previousStock, newStock: previousStock,
      originalQuantity: inputQuantity, originalUnit: sourceUnit, convertedQuantity: quantity, convertedUnit: item.baseUnit || sourceUnit,
      warehouseCode: warehouse.code, reason: reason || (operation === 'QUARANTINE' ? 'Stock moved to quarantine' : 'Stock released from quarantine'), reference: payload.reference,
    })
  }

  if (operation === 'RESERVE' || operation === 'RELEASE_RESERVATION' || operation === 'MARK_INCOMING' || operation === 'CLEAR_INCOMING') {
    const balance = await getBalance(warehouse, item, warehouse.code === DEFAULT_WAREHOUSE_CODE ? Number(item.stock || 0) : 0)
    if (operation === 'RESERVE') {
      if (quantity > availableQuantity(balance)) throw httpError(400, 'Insufficient available stock to reserve')
      balance.reserved = round(Number(balance.reserved || 0) + quantity)
    } else if (operation === 'RELEASE_RESERVATION') {
      if (quantity > Number(balance.reserved || 0)) throw httpError(400, 'Insufficient reserved stock to release')
      balance.reserved = round(Number(balance.reserved || 0) - quantity)
    } else if (operation === 'MARK_INCOMING') {
      balance.incoming = round(Number(balance.incoming || 0) + quantity)
    } else {
      if (quantity > Number(balance.incoming || 0)) throw httpError(400, 'Cannot clear more incoming stock than is recorded')
      balance.incoming = round(Number(balance.incoming || 0) - quantity)
    }
    balance.updatedBy = auditActor()
    await balance.save()
    const previousStock = Number(item.stock || 0)
    return createMovement({
      date, item, type: ['MARK_INCOMING', 'CLEAR_INCOMING'].includes(operation) ? 'INCOMING' : 'RESERVATION', quantity: 0, previousStock, newStock: previousStock,
      originalQuantity: inputQuantity, originalUnit: sourceUnit, convertedQuantity: quantity, convertedUnit: item.baseUnit || sourceUnit,
      warehouseCode: warehouse.code, reason: reason || labelForOperation(operation), reference: payload.reference,
    })
  }

  const operationType = {
    ISSUE: 'ADJUSTMENT',
    PRODUCTION_CONSUMPTION: 'PRODUCTION_CONSUMPTION',
    SALE: 'SALE',
    DAMAGE: 'DAMAGE',
    EXPIRY: 'EXPIRY',
    WASTE: 'WASTE',
  }[operation]
  if (!operationType) throw httpError(400, 'Choose a supported stock operation')
  const balance = await getBalance(warehouse, item, warehouse.code === DEFAULT_WAREHOUSE_CODE ? Number(item.stock || 0) : 0)
  const allowNegative = Boolean(payload.allowNegative) && ['admin', 'system_admin'].includes(String(currentTenant().role || '').toLowerCase())
  const reservedForConsumption = operation === 'PRODUCTION_CONSUMPTION' && payload.consumeReserved ? Number(balance.reserved || 0) : 0
  if (!allowNegative && quantity > availableQuantity(balance) + reservedForConsumption) {
    throw httpError(400, `Only ${availableQuantity(balance)} ${item.baseUnit || 'units'} are available in ${warehouse.name}`)
  }
  balance.onHand = round(Number(balance.onHand || 0) - quantity)
  if (reservedForConsumption > 0) balance.reserved = round(Math.max(0, Number(balance.reserved || 0) - quantity))
  balance.updatedBy = auditActor()
  await balance.save()
  updateItemStock(item, -quantity)
  store.inventory[itemIndex] = item
  await storeModel.writeStore(store)
  return createMovement({
    date, item, type: operationType, quantity: -quantity, previousStock: Number(item.stock || 0) + quantity, newStock: Number(item.stock || 0),
    originalQuantity: inputQuantity, originalUnit: sourceUnit, convertedQuantity: quantity, convertedUnit: item.baseUnit || sourceUnit,
    warehouseCode: warehouse.code, reason: reason || `${operationType.replace(/_/g, ' ').toLowerCase()} recorded`, reference: payload.reference,
    partner: payload.partner, batchNumber: payload.batchNumber, expiryDate: payload.expiryDate, serialNumber: payload.serialNumber,
  })
}

async function ensureQuarantineWarehouse() {
  const tenant = requireTenant()
  const code = 'QUALITY-QUARANTINE'
  return Warehouse.findOneAndUpdate(
    { ownerKey: tenant.ownerKey, branchCode: currentBranchCode(), code },
    {
      $setOnInsert: {
        ownerKey: tenant.ownerKey,
        ownerEmail: tenant.ownerEmail,
        branchCode: currentBranchCode(),
        code,
        name: 'Quality Quarantine',
        type: 'quarantine',
        active: true,
        createdBy: auditActor(),
        updatedBy: auditActor(),
      },
    },
    { upsert: true, returnDocument: 'after' }
  )
}

async function applyLedgerMovement(data = {}) {
  const quantity = Number(data.quantity || 0)
  if (!data.sku || !Number.isFinite(quantity) || quantity === 0) return
  const warehouseCode = normalizeWarehouseCode(data.warehouseCode || (quantity < 0 ? data.fromWarehouseCode : data.toWarehouseCode) || DEFAULT_WAREHOUSE_CODE)
  const store = await storeModel.readStore()
  const item = store.inventory.find((row) => row.sku === data.sku)
  if (!item) return
  const warehouse = await findWarehouse(warehouseCode)
  const initial = warehouse.code === DEFAULT_WAREHOUSE_CODE ? Number(data.previousStock || 0) : 0
  const balance = await getBalance(warehouse, item, initial)
  balance.onHand = round(Number(balance.onHand || 0) + quantity)
  balance.updatedBy = auditActor()
  await balance.save()
}

async function assertWarehouseAvailable({ item, quantity, warehouseCode = '' }) {
  if (!storeModel.WarehouseStock) return
  const requested = Number(quantity || 0)
  if (!Number.isFinite(requested) || requested <= 0) return
  const warehouse = await findWarehouse(warehouseCode || item.defaultWarehouseCode)
  const initial = warehouse.code === DEFAULT_WAREHOUSE_CODE ? Number(item.stock || 0) : 0
  const balance = await getBalance(warehouse, item, initial)
  if (requested > availableQuantity(balance)) {
    throw httpError(400, `Only ${availableQuantity(balance)} ${item.baseUnit || 'units'} are available in ${warehouse.name}`)
  }
}

async function getAverageCost(item, warehouseCode = '') {
  if (!storeModel.WarehouseStock) return Number(item.purchasePrice ?? item.price ?? 0)
  const warehouse = await findWarehouse(warehouseCode || item.defaultWarehouseCode)
  const initial = warehouse.code === DEFAULT_WAREHOUSE_CODE ? Number(item.stock || 0) : 0
  const balance = await getBalance(warehouse, item, initial)
  const averageCost = Number(balance.averageCost || 0)
  return averageCost > 0 ? averageCost : Number(item.purchasePrice ?? item.price ?? 0)
}

async function findWarehouse(code) {
  const tenant = requireTenant()
  await ensureDefaultWarehouse()
  const warehouseCode = normalizeWarehouseCode(code || DEFAULT_WAREHOUSE_CODE)
  const warehouse = await Warehouse.findOne({ ownerKey: tenant.ownerKey, branchCode: currentBranchCode(), code: warehouseCode, active: { $ne: false } })
  if (!warehouse) throw httpError(400, 'Choose an active warehouse in the current branch')
  return warehouse
}

async function getBalance(warehouse, item, initialOnHand = 0) {
  const tenant = requireTenant()
  let balance = await WarehouseStock.findOne({ ownerKey: tenant.ownerKey, branchCode: currentBranchCode(), warehouseCode: warehouse.code, sku: item.sku })
  if (balance) return balance
  balance = new WarehouseStock({
    ownerKey: tenant.ownerKey,
    ownerEmail: tenant.ownerEmail,
    branchCode: currentBranchCode(),
    warehouseCode: warehouse.code,
    sku: item.sku,
    onHand: round(initialOnHand),
    averageCost: Number(item.purchasePrice ?? item.price ?? 0),
    updatedBy: auditActor(),
  })
  await balance.save()
  return balance
}

async function createMovement(data) {
  const StockMovement = storeModel.StockMovement
  return StockMovement.create(storeModel.withBranchFields({
    date: data.date,
    sku: data.item.sku,
    type: data.type,
    quantity: round(data.quantity),
    originalQuantity: Number(data.originalQuantity || 0),
    originalUnit: data.originalUnit || '',
    convertedQuantity: Number(data.convertedQuantity || Math.abs(data.quantity || 0)),
    convertedUnit: data.convertedUnit || data.item.baseUnit || '',
    warehouseCode: data.warehouseCode || '',
    fromWarehouseCode: data.fromWarehouseCode || '',
    toWarehouseCode: data.toWarehouseCode || '',
    batchNumber: data.batchNumber || '',
    expiryDate: data.expiryDate || '',
    serialNumber: data.serialNumber || '',
    previousStock: round(data.previousStock),
    newStock: round(data.newStock),
    reason: data.reason || '',
    reference: data.reference || '',
    partner: data.partner || '',
    user: auditActor().username || 'System',
  }))
}

function normalizeWarehouse(payload = {}, fallback = {}) {
  const name = String(payload.name ?? fallback.name ?? '').trim()
  const code = normalizeWarehouseCode(payload.code ?? fallback.code ?? name)
  const type = String(payload.type ?? fallback.type ?? 'general').trim().toLowerCase()
  if (!name || !code) throw httpError(400, 'Warehouse name and code are required')
  if (!WAREHOUSE_TYPES.has(type)) throw httpError(400, 'Choose a valid warehouse type')
  return {
    name,
    code,
    type,
    address: String(payload.address ?? fallback.address ?? '').trim(),
    active: payload.active === undefined ? fallback.active !== false : Boolean(payload.active),
  }
}

function normalizeWarehouseCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_')
}

function updateItemStock(item, delta) {
  const next = round(Number(item.stock || 0) + Number(delta || 0))
  item.stock = next
  const reorder = Number(item.reorderLevel ?? 0)
  const capacity = Number(item.maximumStock || item.capacity || 0)
  item.status = next <= 0 ? 'Out of Stock' : (reorder > 0 && next <= reorder) || (capacity > 0 && next <= capacity * 0.2) ? 'Low' : 'Active'
}

function resolveAverageCost(balance, item, receivedQuantity, unitCost) {
  const existing = Number(balance.onHand || 0) - receivedQuantity
  const currentCost = Number(balance.averageCost ?? item.purchasePrice ?? item.price ?? 0)
  const total = Math.max(0, existing) * currentCost + receivedQuantity * Math.max(0, unitCost)
  return receivedQuantity + Math.max(0, existing) > 0 ? round(total / (receivedQuantity + Math.max(0, existing))) : currentCost
}

function availableQuantity(balance) {
  return round(Number(balance.onHand || 0) - Number(balance.reserved || 0))
}

function labelForOperation(operation) {
  return String(operation).toLowerCase().replace(/_/g, ' ')
}

function round(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 1e8) / 1e8
}

function requireTenant() {
  const tenant = currentTenant()
  if (!tenant.ownerKey) throw httpError(403, 'Select a business before managing warehouses')
  return tenant
}

module.exports = {
  DEFAULT_WAREHOUSE_CODE,
  applyLedgerMovement,
  assertWarehouseAvailable,
  createWarehouse,
  ensureDefaultWarehouse,
  ensureQuarantineWarehouse,
  getAverageCost,
  listBalances,
  listExpiryAlerts,
  listWarehouses,
  recordStockOperation,
  updateWarehouse,
}

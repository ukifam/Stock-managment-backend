const BranchTransfer = require('../models/BranchTransfer')
const Branch = require('../models/Branch')
const storeModel = require('../models/storeModel')
const httpError = require('../utils/httpError')
const CacheManager = require('../utils/cache')
const { escapeRegex, findInventoryItem, inventoryStatus } = require('../utils/inventoryMatch')
const { MAIN_BRANCH_CODE, auditActor, currentTenant, normalizeBranchCode } = require('../utils/tenantContext')
const stockMovementService = require('./stockMovementService')

const STATUSES = ['IN_TRANSIT', 'RECEIVED', 'CANCELLED']

function today() {
  return new Date().toISOString().slice(0, 10)
}

function currentBranch() {
  return normalizeBranchCode(currentTenant().branchCode || MAIN_BRANCH_CODE)
}

async function branchNames(ownerKey) {
  const branches = await Branch.find({ ownerKey }).select('code name active').lean()
  const rows = branches.length ? branches : [{ code: MAIN_BRANCH_CODE, name: 'Main branch', active: true }]
  return {
    names: new Map(rows.map((branch) => [normalizeBranchCode(branch.code), branch.name || branch.code])),
    active: rows.filter((branch) => branch.active !== false),
  }
}

function serialize(transfer, branch, names) {
  const items = transfer.items || []
  const sent = items.reduce((sum, row) => sum + Number(row.quantity || 0), 0)
  const received = items.reduce((sum, row) => sum + Number(row.receivedQuantity || 0), 0)
  return {
    id: String(transfer._id),
    reference: transfer.reference,
    direction: transfer.fromBranch === branch ? 'OUT' : 'IN',
    fromBranch: transfer.fromBranch,
    fromName: names.get(transfer.fromBranch) || transfer.fromBranch,
    toBranch: transfer.toBranch,
    toName: names.get(transfer.toBranch) || transfer.toBranch,
    status: transfer.status === 'RECEIVING' ? 'IN_TRANSIT' : transfer.status,
    items,
    totalUnits: sent,
    receivedUnits: received,
    shortage: transfer.status === 'RECEIVED' ? Math.max(0, sent - received) : 0,
    value: items.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.unitCost || 0), 0),
    transporter: transfer.transporter || '',
    notes: transfer.notes || '',
    receiveNotes: transfer.receiveNotes || '',
    sentDate: transfer.sentDate,
    expectedDate: transfer.expectedDate || '',
    receivedDate: transfer.receivedDate || '',
    sentBy: transfer.sentBy?.username || '',
    receivedBy: transfer.receivedBy?.username || '',
    createdAt: transfer.createdAt,
  }
}

async function listBranchTransfers({ status = 'ALL', search = '' } = {}) {
  const tenant = currentTenant()
  const branch = currentBranch()
  const query = { ownerKey: tenant.ownerKey, $or: [{ fromBranch: branch }, { toBranch: branch }] }
  const wanted = String(status || 'ALL').toUpperCase()
  if (wanted === 'IN_TRANSIT') query.status = { $in: ['IN_TRANSIT', 'RECEIVING'] }
  else if (STATUSES.includes(wanted)) query.status = wanted
  const term = String(search || '').trim()
  if (term) {
    const pattern = { $regex: escapeRegex(term), $options: 'i' }
    query.$and = [{ $or: [{ reference: pattern }, { 'items.item': pattern }, { 'items.sku': pattern }, { transporter: pattern }] }]
  }

  const [rows, { names, active }, incoming] = await Promise.all([
    BranchTransfer.find(query).sort({ createdAt: -1 }).limit(300).lean(),
    branchNames(tenant.ownerKey),
    BranchTransfer.countDocuments({ ownerKey: tenant.ownerKey, toBranch: branch, status: { $in: ['IN_TRANSIT', 'RECEIVING'] } }),
  ])
  return {
    rows: rows.map((row) => serialize(row, branch, names)),
    currentBranch: { code: branch, name: names.get(branch) || branch },
    branches: active
      .map((row) => ({ code: normalizeBranchCode(row.code), name: row.name || row.code }))
      .filter((row) => row.code !== branch),
    incomingCount: incoming,
  }
}

function normalizeLines(items) {
  const merged = new Map()
  for (const line of Array.isArray(items) ? items : []) {
    const sku = String(line?.sku || '').trim()
    const quantity = Number(line?.quantity)
    if (!sku) throw httpError(400, 'Select a product for every line')
    if (!Number.isFinite(quantity) || quantity <= 0) throw httpError(400, 'Every quantity must be greater than zero')
    merged.set(sku, (merged.get(sku) || 0) + quantity)
  }
  if (!merged.size) throw httpError(400, 'Add at least one product to transfer')
  return [...merged.entries()].map(([sku, quantity]) => ({ sku, quantity }))
}

async function sendBranchTransfer(body = {}) {
  const tenant = currentTenant()
  const fromBranch = currentBranch()
  const toBranch = normalizeBranchCode(body.toBranch)
  if (!toBranch) throw httpError(400, 'Choose the shop receiving the stock')
  if (toBranch === fromBranch) throw httpError(400, 'Choose a different shop than the one sending the stock')

  const { names, active } = await branchNames(tenant.ownerKey)
  if (!active.some((branch) => normalizeBranchCode(branch.code) === toBranch)) throw httpError(400, 'The receiving shop is not available')

  const lines = normalizeLines(body.items)
  const stockRows = await storeModel.Inventory.find(storeModel.branchScopedQuery({ sku: { $in: lines.map((line) => line.sku) } })).lean()
  const items = lines.map((line) => {
    const row = stockRows.find((stock) => stock.sku === line.sku)
    if (!row) throw httpError(404, `Product ${line.sku} was not found in this shop`)
    const available = Number(row.stock || 0)
    if (line.quantity > available) throw httpError(400, `Only ${available} ${row.baseUnit || 'units'} of ${row.item} are in stock`)
    return {
      sku: row.sku,
      item: row.item,
      category: row.category || 'General',
      unit: row.baseUnit || 'piece',
      quantity: line.quantity,
      unitCost: Number(row.purchasePrice || row.price || 0),
      sellingPrice: Number(row.sellingPrice || 0),
    }
  })

  const reference = `TRF-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 4).toUpperCase()}`
  const date = String(body.date || today())
  const toName = names.get(toBranch) || toBranch
  const actor = auditActor()

  const deducted = []
  try {
    for (const row of items) {
      await stockMovementService.adjustStock({
        sku: row.sku,
        quantity: -row.quantity,
        type: 'TRANSFER_OUT',
        reason: `Sent to ${toName} (${reference})`,
        reference,
        partner: toName,
        date,
        user: actor.username || 'System',
      })
      deducted.push(row)
    }
    const transfer = await BranchTransfer.create({
      ownerKey: tenant.ownerKey,
      reference,
      fromBranch,
      toBranch,
      status: 'IN_TRANSIT',
      items,
      transporter: String(body.transporter || '').trim(),
      notes: String(body.notes || '').trim(),
      sentDate: date,
      expectedDate: String(body.expectedDate || ''),
      sentBy: actor,
    })
    CacheManager.clear()
    return serialize(transfer.toObject(), fromBranch, names)
  } catch (error) {
    for (const row of deducted) {
      await stockMovementService.adjustStock({
        sku: row.sku, quantity: row.quantity, type: 'TRANSFER_IN', reason: `Rollback of failed transfer ${reference}`, reference, date,
      }).catch(() => {})
    }
    throw error
  }
}

// Finds the product in the current shop, matching by SKU then name, and creates it if missing.
async function ensureLocalProduct(line) {
  const inventory = await storeModel.Inventory.find(storeModel.branchScopedQuery({})).select('sku item').lean()
  const existing = findInventoryItem(inventory, { sku: line.sku, item: line.item })
  if (existing) return existing.sku
  await storeModel.Inventory.create(storeModel.withBranchFields({
    date: today(),
    item: line.item,
    sku: line.sku,
    category: line.category || 'General',
    baseUnit: line.unit || 'piece',
    stock: 0,
    price: line.unitCost,
    purchasePrice: line.unitCost,
    sellingPrice: line.sellingPrice,
    status: inventoryStatus(0, {}),
  }))
  return line.sku
}

async function receiveBranchTransfer(id, body = {}) {
  const tenant = currentTenant()
  const branch = currentBranch()
  const transfer = await findTransfer(id)
  if (transfer.toBranch !== branch) {
    const { names } = await branchNames(tenant.ownerKey)
    throw httpError(403, `Switch to ${names.get(transfer.toBranch) || transfer.toBranch} to receive this transfer`)
  }
  if (transfer.status !== 'IN_TRANSIT') throw httpError(409, 'This transfer is no longer in transit')

  const counts = new Map((Array.isArray(body.items) ? body.items : []).map((line) => [String(line?.sku || ''), Number(line?.receivedQuantity)]))
  const items = transfer.items.map((line) => {
    const received = counts.has(line.sku) ? counts.get(line.sku) : Number(line.quantity)
    if (!Number.isFinite(received) || received < 0) throw httpError(400, `Enter how many ${line.item} arrived`)
    if (received > Number(line.quantity)) throw httpError(400, `More ${line.item} received than were sent (${line.quantity})`)
    return { ...line, receivedQuantity: received }
  })

  // Claim the transfer so it cannot be received twice.
  const claimed = await BranchTransfer.updateOne({ _id: transfer._id, status: 'IN_TRANSIT' }, { $set: { status: 'RECEIVING' } })
  if (!claimed.modifiedCount) throw httpError(409, 'This transfer is already being received')

  const { names } = await branchNames(tenant.ownerKey)
  const fromName = names.get(transfer.fromBranch) || transfer.fromBranch
  const date = String(body.date || today())
  const actor = auditActor()
  const added = []
  try {
    for (const line of items) {
      if (!line.receivedQuantity) continue
      line.receivedSku = await ensureLocalProduct(line)
      await stockMovementService.adjustStock({
        sku: line.receivedSku,
        quantity: line.receivedQuantity,
        type: 'TRANSFER_IN',
        reason: `Received from ${fromName} (${transfer.reference})`,
        reference: transfer.reference,
        partner: fromName,
        date,
        user: actor.username || 'System',
      })
      added.push(line)
    }
  } catch (error) {
    for (const line of added) {
      await stockMovementService.adjustStock({
        sku: line.receivedSku, quantity: -line.receivedQuantity, type: 'ADJUSTMENT', reason: `Rollback of failed receipt ${transfer.reference}`, reference: transfer.reference, date,
      }).catch(() => {})
    }
    await BranchTransfer.updateOne({ _id: transfer._id }, { $set: { status: 'IN_TRANSIT' } })
    throw error
  }

  const updated = await BranchTransfer.findOneAndUpdate(
    { _id: transfer._id },
    { $set: { status: 'RECEIVED', items, receivedDate: date, receivedBy: actor, receiveNotes: String(body.notes || '').trim() } },
    { returnDocument: 'after' },
  ).lean()
  CacheManager.clear()
  return serialize(updated, branch, names)
}

async function cancelBranchTransfer(id) {
  const tenant = currentTenant()
  const branch = currentBranch()
  const transfer = await findTransfer(id)
  if (transfer.fromBranch !== branch) throw httpError(403, 'Only the sending shop can cancel a transfer')

  const actor = auditActor()
  const claimed = await BranchTransfer.findOneAndUpdate(
    { _id: transfer._id, status: 'IN_TRANSIT' },
    { $set: { status: 'CANCELLED', cancelledBy: actor } },
    { returnDocument: 'after' },
  ).lean()
  if (!claimed) throw httpError(409, 'Only transfers still in transit can be cancelled')

  const date = today()
  for (const line of claimed.items) {
    const sku = await ensureLocalProduct(line)
    await stockMovementService.adjustStock({
      sku,
      quantity: line.quantity,
      type: 'TRANSFER_IN',
      reason: `Transfer ${claimed.reference} cancelled`,
      reference: claimed.reference,
      date,
      user: actor.username || 'System',
    })
  }
  CacheManager.clear()
  const { names } = await branchNames(tenant.ownerKey)
  return serialize(claimed, branch, names)
}

async function findTransfer(id) {
  if (!/^[a-f\d]{24}$/i.test(String(id))) throw httpError(400, 'Invalid transfer ID')
  const transfer = await BranchTransfer.findOne({ _id: id, ownerKey: currentTenant().ownerKey }).lean()
  if (!transfer) throw httpError(404, 'Transfer not found')
  return transfer
}

module.exports = {
  cancelBranchTransfer,
  listBranchTransfers,
  receiveBranchTransfer,
  sendBranchTransfer,
}

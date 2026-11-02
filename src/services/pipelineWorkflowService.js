const Pipeline = require('../models/Pipeline')
const Notification = require('../models/Notification')
const storeModel = require('../models/storeModel')
const httpError = require('../utils/httpError')
const CacheManager = require('../utils/cache')
const { auditActor, branchScopedQuery, currentTenant } = require('../utils/tenantContext')
const { inventoryStatus, isFinishedProduct, matchByName, normalizeText } = require('../utils/inventoryMatch')
const stockMovementService = require('./stockMovementService')
const purchaseService = require('./purchaseService')
const { sendProductionActivityEmail } = require('./notificationMailer')

// Order → check stock → (purchase order → payment → receive) → make → quality check → store.
const STAGES = ['plan', 'check_stock', 'purchase_order', 'payment', 'receive', 'make', 'quality_check', 'store', 'done']
const PURCHASE_STAGES = ['purchase_order', 'payment', 'receive']
const STAGE_LABELS = {
  plan: 'Order',
  check_stock: 'Check stock',
  purchase_order: 'Purchase order',
  payment: 'Payment',
  receive: 'Receive',
  make: 'Make',
  quality_check: 'Quality check',
  store: 'Store',
  done: 'Complete',
}
const STAGE_OWNERS = {
  check_stock: 'Production',
  purchase_order: 'Procurement',
  payment: 'Finance',
  receive: 'Store',
  make: 'Production',
  quality_check: 'Quality',
  store: 'Store',
}
// Older pipelines used an 11-step flow ending in sell/cost/analyze.
const LEGACY_STAGES = {
  receive_plan: 'check_stock',
  purchase: 'check_stock',
  store_raw: 'make',
  produce: 'make',
  finish: 'store',
  store_finished: 'store',
  sell: 'done',
  cost: 'done',
  analyze: 'done',
}
const PAYMENT_METHODS = ['Cash', 'Mobile Money', 'Bank Transfer', 'Card', 'Credit']
const LOCK_TIMEOUT_MS = 2 * 60 * 1000

function normalizeStage(stage) {
  const value = String(stage || 'plan')
  return STAGES.includes(value) ? value : LEGACY_STAGES[value] || 'plan'
}

function round(value) {
  return Number(Number(value || 0).toFixed(4))
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function money(value) {
  return Math.round(Number(value || 0)).toLocaleString('en-US')
}

function uniqueSku(prefix, name) {
  const slug = normalizeText(name).replace(/ /g, '-').toUpperCase().slice(0, 14) || 'ITEM'
  return `${prefix}-${slug}-${Date.now().toString(36).slice(-4).toUpperCase()}`
}

function serializePipeline(pipeline) {
  const source = pipeline?.toObject ? pipeline.toObject() : { ...pipeline }
  const { lockedAt: _lockedAt, ...rest } = source
  return {
    ...rest,
    currentStage: normalizeStage(source.currentStage),
    completedStages: [...new Set((source.completedStages || []).map(normalizeStage))].filter((stage) => stage !== 'done'),
    skippedStages: source.skippedStages || [],
    receipts: source.receipts || [],
  }
}

/* Plan (order) fields are the only part a client may edit directly, and only before submitting. */
function planFields(payload = {}) {
  const targetQuantity = Number(payload.targetQuantity) || 0
  const ingredients = (Array.isArray(payload.ingredients) ? payload.ingredients : [])
    .map((ing, index) => ({
      id: String(ing?.id || index + 1),
      name: String(ing?.name || '').trim(),
      quantity: Number(ing?.quantity) || 0,
      unit: String(ing?.unit || 'unit').trim(),
      unitCost: Math.max(0, Number(ing?.unitCost) || 0),
    }))
    .filter((ing) => ing.name)
  const totalIngredients = ingredients.map((ing) => ({
    ...ing,
    totalQuantity: round(ing.quantity * targetQuantity),
    totalCost: round(ing.quantity * targetQuantity * ing.unitCost),
  }))
  return {
    productName: String(payload.productName || '').trim(),
    businessType: String(payload.businessType || '').trim(),
    singleUnitLabel: String(payload.singleUnitLabel || 'unit').trim(),
    ingredients,
    targetQuantity,
    scheduledDate: String(payload.scheduledDate || '').trim(),
    sellingPricePerUnit: Math.max(0, Number(payload.sellingPricePerUnit) || 0),
    totalIngredients,
    totalMaterialCost: round(totalIngredients.reduce((sum, ing) => sum + ing.totalCost, 0)),
  }
}

function actorFrom(user = {}) {
  const role = String(user.role || '').toLowerCase()
  return {
    username: user.username || 'Staff',
    role: user.shopRole && !['admin', 'system_admin'].includes(role) ? user.shopRole : role || 'staff',
    isAdmin: role === 'admin' || role === 'system_admin',
  }
}

async function claim(id, expectedStage, actor) {
  const pipeline = await Pipeline.findOne(branchScopedQuery({ id }))
  if (!pipeline) throw httpError(404, 'Production order not found')
  const stage = normalizeStage(pipeline.currentStage)
  if (stage !== expectedStage) {
    throw httpError(409, `This order is at "${STAGE_LABELS[stage]}", not "${STAGE_LABELS[expectedStage]}". Refresh to see the latest.`)
  }
  if (pipeline.executionMode === 'solo' && !actor.isAdmin) {
    throw httpError(403, 'This order is in Solo mode: only the shop administrator can run its steps')
  }
  const claimed = await Pipeline.findOneAndUpdate(
    { _id: pipeline._id, $or: [{ lockedAt: null }, { lockedAt: { $lt: new Date(Date.now() - LOCK_TIMEOUT_MS) } }] },
    { $set: { lockedAt: new Date() } },
    { returnDocument: 'after' },
  )
  if (!claimed) throw httpError(409, 'Someone else is updating this order. Try again in a moment.')
  return claimed
}

async function runStep(id, expectedStage, user, step) {
  const actor = actorFrom(user)
  const pipeline = await claim(id, expectedStage, actor)
  try {
    const outcome = await step(pipeline, actor)
    pipeline.lockedAt = null
    pipeline.updatedAt = new Date().toISOString()
    pipeline.updatedBy = auditActor()
    await pipeline.save()
    CacheManager.clear()
    notify(pipeline, outcome, actor)
    return serializePipeline(pipeline)
  } catch (error) {
    await Pipeline.updateOne({ _id: pipeline._id }, { $set: { lockedAt: null } })
    throw error
  }
}

function advance(pipeline, to, actor, summary) {
  const from = normalizeStage(pipeline.currentStage)
  const completed = new Set((pipeline.completedStages || []).map(normalizeStage))
  completed.add(from)
  pipeline.completedStages = [...completed].filter((stage) => stage !== 'done')
  pipeline.currentStage = to
  pipeline.activityLog = [{
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    stage: from,
    stageLabel: STAGE_LABELS[from],
    performedBy: actor.username,
    performedByRole: actor.role,
    timestamp: new Date().toISOString(),
    summary,
  }, ...(pipeline.activityLog || [])].slice(0, 200)
  return { from, to, summary }
}

// Tells the shop who has to act next. Never blocks the step itself.
function notify(pipeline, outcome, actor) {
  if (!outcome?.to) return
  const tenant = currentTenant()
  const product = pipeline.productName || pipeline.id
  const title = outcome.to === 'done'
    ? `Production complete: ${product}`
    : `${STAGE_OWNERS[outcome.to] || 'Next'}: ${STAGE_LABELS[outcome.to]} for ${product}`
  Notification.create({
    ownerKey: tenant.ownerKey,
    actorId: tenant.userId,
    actorUsername: actor.username,
    actorRole: actor.role,
    title,
    message: outcome.summary,
    category: 'production',
    severity: outcome.to === 'done' ? 'success' : 'info',
    targetPage: 'production-pipeline',
    actionLabel: 'Open order',
    metadata: { pipelineId: pipeline.id, stage: outcome.to },
  }).catch(() => {})
  sendProductionActivityEmail({
    adminEmail: tenant.ownerEmail,
    workerName: actor.username,
    workerRole: actor.role,
    stageLabel: STAGE_LABELS[outcome.from],
    productName: product,
    pipelineId: pipeline.id,
    details: outcome.summary,
  }).catch(() => {})
}

/* ── Stock check ── */
async function stockCheckFor(pipeline) {
  const inventory = await storeModel.Inventory.find(branchScopedQuery({})).lean()
  const materials = inventory.filter((row) => !isFinishedProduct(row))
  return (pipeline.totalIngredients || []).map((ing) => {
    const row = matchByName(materials, ing.name) || matchByName(inventory, ing.name)
    const needed = round(ing.totalQuantity)
    const inStock = row ? round(row.stock) : 0
    return {
      ingredientId: ing.id,
      name: ing.name,
      unit: ing.unit,
      needed,
      inStock,
      shortage: round(Math.max(0, needed - inStock)),
      sku: row?.sku || '',
      stockItem: row?.item || '',
      stockUnit: row?.baseUnit || '',
      category: row?.category || '',
      unitCost: Number(row?.purchasePrice || row?.price || ing.unitCost || 0),
      plannedUnitCost: Number(ing.unitCost || 0),
    }
  })
}

async function getStockCheck(id) {
  const pipeline = await Pipeline.findOne(branchScopedQuery({ id })).lean()
  if (!pipeline) throw httpError(404, 'Production order not found')
  return { lines: await stockCheckFor(pipeline) }
}

/* 1. Order: save the plan and send it for a stock check. */
async function submitOrder(id, body, user) {
  return runStep(id, 'plan', user, (pipeline, actor) => {
    const plan = planFields({ ...serializePipeline(pipeline), ...body })
    if (!plan.productName) throw httpError(400, 'Name the product to make')
    if (!(plan.targetQuantity > 0)) throw httpError(400, 'Enter how many to make')
    if (!plan.ingredients.length) throw httpError(400, 'Add at least one material to the recipe')
    Object.assign(pipeline, plan)
    return advance(pipeline, 'check_stock', actor, `Ordered ${plan.targetQuantity} ${plan.singleUnitLabel} of ${plan.productName}`)
  })
}

/* 2. Check stock: everything there → make; otherwise send the shortage to procurement. */
async function checkStock(id, user) {
  return runStep(id, 'check_stock', user, async (pipeline, actor) => {
    const lines = await stockCheckFor(pipeline)
    const short = lines.filter((line) => line.shortage > 0)
    if (!short.length) {
      pipeline.requisition = null
      if (!(pipeline.receipts || []).length) pipeline.skippedStages = PURCHASE_STAGES
      return advance(pipeline, 'make', actor, 'All materials are in stock: ready to make')
    }
    pipeline.skippedStages = []
    pipeline.purchaseOrder = null
    pipeline.payment = null
    pipeline.requisition = {
      date: today(),
      by: actor.username,
      lines: short.map((line) => ({
        ingredientId: line.ingredientId,
        name: line.name,
        unit: line.unit,
        needed: line.needed,
        inStock: line.inStock,
        shortage: line.shortage,
        unitCost: line.unitCost || line.plannedUnitCost,
      })),
    }
    pipeline.markModified('requisition')
    return advance(pipeline, 'purchase_order', actor, `${short.length} material${short.length === 1 ? '' : 's'} short: ${short.map((line) => `${line.shortage} ${line.unit} ${line.name}`).join(', ')}`)
  })
}

/* Stock changed between the check and making (e.g. used elsewhere): check again. */
async function recheckStock(id, user) {
  return runStep(id, 'make', user, (pipeline, actor) => {
    const outcome = advance(pipeline, 'check_stock', actor, 'Stock changed before making: checking again')
    pipeline.completedStages = pipeline.completedStages.filter((stage) => stage !== 'make')
    return outcome
  })
}

/* 3. Procurement raises the purchase order. */
async function createPurchaseOrder(id, body, user) {
  return runStep(id, 'purchase_order', user, (pipeline, actor) => {
    const requisition = pipeline.requisition
    if (!requisition?.lines?.length) throw httpError(400, 'There is nothing to purchase for this order')
    const supplier = String(body.supplier || '').trim()
    if (!supplier) throw httpError(400, 'Enter the supplier')
    const given = new Map((Array.isArray(body.lines) ? body.lines : []).map((line) => [String(line?.ingredientId), line]))
    const lines = requisition.lines.map((req) => {
      const line = given.get(String(req.ingredientId)) || {}
      const quantity = round(line.quantity ?? req.shortage)
      const unitPrice = Number(line.unitPrice ?? req.unitCost)
      if (!(quantity + 0.0001 >= req.shortage)) throw httpError(400, `Order at least ${req.shortage} ${req.unit} of ${req.name}`)
      if (!Number.isFinite(unitPrice) || unitPrice < 0) throw httpError(400, `Enter a price for ${req.name}`)
      return { ingredientId: req.ingredientId, name: req.name, unit: req.unit, quantity, unitPrice, total: round(quantity * unitPrice) }
    })
    const total = round(lines.reduce((sum, line) => sum + line.total, 0))
    const number = `PO-${pipeline.id.replace(/^PP-/, '').slice(0, 8)}-${(pipeline.receipts || []).length + 1}`
    pipeline.purchaseOrder = {
      number,
      date: today(),
      by: actor.username,
      byId: currentTenant().userId || '',
      supplier,
      expectedDate: String(body.expectedDate || ''),
      notes: String(body.notes || '').trim(),
      lines,
      total,
    }
    pipeline.markModified('purchaseOrder')
    return advance(pipeline, 'payment', actor, `${number} to ${supplier} for ${money(total)} sent to finance`)
  })
}

/* 4. Finance approves and pays. */
async function payPurchaseOrder(id, body, user) {
  return runStep(id, 'payment', user, (pipeline, actor) => {
    const order = pipeline.purchaseOrder
    if (!order) throw httpError(400, 'There is no purchase order to pay')
    if (!actor.isAdmin && order.byId && order.byId === currentTenant().userId) {
      throw httpError(403, 'The person who raised a purchase order cannot also approve its payment')
    }
    const method = PAYMENT_METHODS.find((option) => option.toLowerCase() === String(body.method || '').trim().toLowerCase())
    if (!method) throw httpError(400, `Choose a payment method: ${PAYMENT_METHODS.join(', ')}`)
    const amountPaid = body.amountPaid === undefined || body.amountPaid === ''
      ? (method === 'Credit' ? 0 : order.total)
      : Number(body.amountPaid)
    if (!Number.isFinite(amountPaid) || amountPaid < 0 || amountPaid > order.total + 0.01) {
      throw httpError(400, `Amount paid must be between 0 and ${money(order.total)}`)
    }
    pipeline.payment = {
      date: today(),
      by: actor.username,
      method,
      amountPaid: round(amountPaid),
      balance: round(order.total - amountPaid),
      reference: String(body.reference || '').trim(),
    }
    pipeline.markModified('payment')
    const summary = amountPaid >= order.total
      ? `${order.number} paid in full (${money(amountPaid)}, ${method})`
      : `${order.number} approved: ${money(amountPaid)} paid, ${money(order.total - amountPaid)} owed (${method})`
    return advance(pipeline, 'receive', actor, `${summary}; waiting for delivery`)
  })
}

/* 5. Store receives the goods: they go into stock and into the purchases ledger. */
async function receiveGoods(id, body, user) {
  return runStep(id, 'receive', user, async (pipeline, actor) => {
    const order = pipeline.purchaseOrder
    const payment = pipeline.payment
    if (!order || !payment) throw httpError(400, 'The purchase order must be paid or approved first')
    const given = new Map((Array.isArray(body.lines) ? body.lines : []).map((line) => [String(line?.ingredientId), Number(line?.quantity)]))
    const lines = order.lines.map((line) => {
      const received = given.has(String(line.ingredientId)) ? given.get(String(line.ingredientId)) : line.quantity
      if (!Number.isFinite(received) || received < 0) throw httpError(400, `Enter how much ${line.name} arrived`)
      if (received > line.quantity + 0.0001) throw httpError(400, `More ${line.name} received than ordered (${line.quantity} ${line.unit})`)
      return { ...line, received: round(received) }
    })
    if (!lines.some((line) => line.received > 0)) throw httpError(400, 'Enter what arrived')

    const stock = await stockCheckFor(pipeline)
    const date = today()
    const created = []
    try {
      for (const line of lines) {
        if (!(line.received > 0)) continue
        const match = stock.find((row) => String(row.ingredientId) === String(line.ingredientId))
        const lineTotal = line.received * line.unitPrice
        const share = order.total > 0 ? Math.min(lineTotal, payment.amountPaid * (lineTotal / order.total)) : 0
        const purchase = await purchaseService.createPurchase({
          item: match?.stockItem || line.name,
          sku: match?.sku || uniqueSku('MAT', line.name),
          supplier: order.supplier,
          category: match?.category || 'Materials',
          quantity: line.received,
          unit: line.unit,
          unitPrice: line.unitPrice,
          payment: payment.method,
          paidAmount: round(share),
          outstanding: round(lineTotal - share),
          date,
          extractedText: `${order.number} for production order ${pipeline.id} (${pipeline.productName})`,
        })
        created.push(purchase.id)
        line.purchaseId = purchase.id
      }
    } catch (error) {
      for (const purchaseId of created) await purchaseService.deletePurchase(purchaseId).catch(() => {})
      throw error
    }

    pipeline.receipts = [...(pipeline.receipts || []), {
      date,
      by: actor.username,
      poNumber: order.number,
      supplier: order.supplier,
      payment: payment.method,
      amountPaid: payment.amountPaid,
      notes: String(body.notes || '').trim(),
      lines: lines.map(({ ingredientId, name, unit, quantity, received, unitPrice, purchaseId }) => ({ ingredientId, name, unit, ordered: quantity, received, unitPrice, purchaseId: purchaseId || '' })),
    }]
    pipeline.markModified('receipts')
    pipeline.rawMaterialsStored = true

    const after = await stockCheckFor(pipeline)
    const stillShort = after.filter((line) => line.shortage > 0)
    const receivedText = lines.filter((line) => line.received > 0).map((line) => `${line.received} ${line.unit} ${line.name}`).join(', ')
    if (stillShort.length) {
      return advance(pipeline, 'check_stock', actor, `Received ${receivedText}; still short of ${stillShort.map((line) => line.name).join(', ')}`)
    }
    return advance(pipeline, 'make', actor, `Received ${receivedText}; all materials ready`)
  })
}

/* 6. Make: materials leave stock. */
async function makeProducts(id, body, user) {
  return runStep(id, 'make', user, async (pipeline, actor) => {
    const produced = Number(body.producedQuantity)
    if (!(produced > 0)) throw httpError(400, 'Enter how many were made')
    const lines = (await stockCheckFor(pipeline)).filter((line) => line.needed > 0)
    const short = lines.filter((line) => line.shortage > 0 || !line.sku)
    if (short.length) {
      throw httpError(409, `Not enough in stock: ${short.map((line) => `${line.name} (need ${line.needed}, have ${line.inStock})`).join(', ')}. Run the stock check again.`)
    }
    const consumed = []
    try {
      for (const line of lines) {
        await stockMovementService.adjustStock({
          sku: line.sku,
          quantity: -line.needed,
          type: 'PRODUCTION_CONSUMPTION',
          reason: `Used to make ${pipeline.productName} (${pipeline.id})`,
          reference: pipeline.id,
          user: actor.username,
        })
        consumed.push(line)
      }
    } catch (error) {
      for (const line of consumed) {
        await stockMovementService.adjustStock({
          sku: line.sku, quantity: line.needed, type: 'ADJUSTMENT', reason: `Rollback for ${pipeline.id}`, reference: pipeline.id,
        }).catch(() => {})
      }
      throw error
    }
    const materialsCost = round(consumed.reduce((sum, line) => sum + line.needed * line.unitCost, 0))
    pipeline.production = {
      date: today(),
      by: actor.username,
      producedQuantity: produced,
      startTime: String(body.startTime || ''),
      endTime: String(body.endTime || ''),
      notes: String(body.notes || '').trim(),
      materialsCost,
      consumed: consumed.map((line) => ({ name: line.stockItem || line.name, sku: line.sku, quantity: line.needed, unit: line.unit, unitCost: line.unitCost })),
    }
    pipeline.markModified('production')
    pipeline.producedQuantity = produced
    pipeline.productionStartTime = pipeline.production.startTime
    pipeline.productionEndTime = pipeline.production.endTime
    pipeline.productionNotes = pipeline.production.notes
    return advance(pipeline, 'quality_check', actor, `Made ${produced} ${pipeline.singleUnitLabel}; materials worth ${money(materialsCost)} taken from stock`)
  })
}

/* 7. Quality check. */
async function checkQuality(id, body, user) {
  return runStep(id, 'quality_check', user, (pipeline, actor) => {
    const produced = Number(pipeline.producedQuantity || pipeline.production?.producedQuantity || 0)
    const passed = Number(body.passedQuantity)
    const rejected = Number(body.rejectedQuantity || 0)
    if (!Number.isFinite(passed) || passed < 0 || !Number.isFinite(rejected) || rejected < 0) throw httpError(400, 'Enter how many passed and were rejected')
    if (passed + rejected > produced + 0.0001) throw httpError(400, `Only ${produced} were made`)
    pipeline.qualityResult = {
      passed: rejected === 0,
      inspectedQuantity: passed + rejected,
      passedQuantity: passed,
      defectQuantity: rejected,
      notes: String(body.notes || '').trim(),
      inspectedBy: String(body.inspector || '').trim() || actor.username,
      date: today(),
    }
    if (passed === 0) {
      return advance(pipeline, 'done', actor, `All ${rejected} rejected in quality check; nothing to store`)
    }
    return advance(pipeline, 'store', actor, `${passed} passed${rejected ? `, ${rejected} rejected` : ''}; ready to store`)
  })
}

/* 8. Store: passed products go into stock at their real cost per unit. */
async function storeProducts(id, body, user) {
  return runStep(id, 'store', user, async (pipeline, actor) => {
    const quantity = Number(pipeline.qualityResult?.passedQuantity || 0)
    if (!(quantity > 0)) throw httpError(400, 'Nothing passed the quality check')
    const sellingPrice = body.sellingPrice === undefined || body.sellingPrice === '' ? Number(pipeline.sellingPricePerUnit || 0) : Number(body.sellingPrice)
    if (!Number.isFinite(sellingPrice) || sellingPrice < 0) throw httpError(400, 'Enter a valid selling price')
    const location = String(body.location || '').trim()
    const unitCost = round(Number(pipeline.production?.materialsCost || 0) / quantity)

    const inventory = await storeModel.Inventory.find(branchScopedQuery({})).lean()
    let product = matchByName(inventory.filter(isFinishedProduct), pipeline.productName)
    if (!product) {
      product = (await storeModel.Inventory.create(storeModel.withBranchFields({
        date: today(),
        item: pipeline.productName,
        meta: 'Made in production',
        sku: uniqueSku('PRD', pipeline.productName),
        category: 'Finished Goods',
        itemType: 'finished_product',
        baseUnit: String(pipeline.singleUnitLabel || 'piece').toLowerCase(),
        stock: 0,
        price: sellingPrice,
        purchasePrice: unitCost,
        sellingPrice,
        shelfLocation: location,
        status: inventoryStatus(0),
      }))).toObject()
    }
    const oldStock = Math.max(0, Number(product.stock || 0))
    const oldCost = Number(product.purchasePrice || 0)
    const averageCost = oldStock + quantity > 0 ? round((oldStock * oldCost + quantity * unitCost) / (oldStock + quantity)) : unitCost
    await storeModel.Inventory.updateOne({ _id: product._id }, {
      $set: {
        purchasePrice: averageCost,
        ...(sellingPrice > 0 ? { sellingPrice, price: sellingPrice } : {}),
        ...(location ? { shelfLocation: location } : {}),
      },
    })
    await stockMovementService.adjustStock({
      sku: product.sku,
      quantity,
      type: 'PRODUCTION_OUTPUT',
      reason: `Made in production order ${pipeline.id}`,
      reference: pipeline.id,
      user: actor.username,
    })

    pipeline.storage = { date: today(), by: actor.username, location, sku: product.sku, item: product.item, quantity, unitCost, sellingPrice }
    pipeline.markModified('storage')
    pipeline.finishedGoodsStored = true
    pipeline.finishedGoodsLocation = location
    if (sellingPrice > 0) pipeline.sellingPricePerUnit = sellingPrice
    return advance(pipeline, 'done', actor, `${quantity} ${pipeline.singleUnitLabel} of ${pipeline.productName} added to stock at ${money(unitCost)} each`)
  })
}

module.exports = {
  PURCHASE_STAGES,
  STAGES,
  checkQuality,
  checkStock,
  createPurchaseOrder,
  getStockCheck,
  makeProducts,
  normalizeStage,
  payPurchaseOrder,
  planFields,
  recheckStock,
  receiveGoods,
  serializePipeline,
  storeProducts,
  submitOrder,
}

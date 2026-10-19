const Unit = require('../models/Unit')
const UnitConversion = require('../models/UnitConversion')
const httpError = require('../utils/httpError')
const { auditActor, currentTenant } = require('../utils/tenantContext')

const DEFAULT_UNITS = [
  ['kilogram', 'kg', 'kg', 'weight'],
  ['gram', 'g', 'g', 'weight'],
  ['litre', 'l', 'L', 'volume'],
  ['millilitre', 'ml', 'ml', 'volume'],
  ['piece', 'piece', 'pc', 'count'],
  ['box', 'box', 'box', 'packaging'],
  ['bag', 'bag', 'bag', 'packaging'],
  ['cup', 'cup', 'cup', 'volume'],
  ['spoon', 'spoon', 'spoon', 'volume'],
  ['hour', 'hour', 'hr', 'time'],
  ['batch', 'batch', 'batch', 'production'],
]

const initializedTenants = new Set()

async function ensureDefaultUnits() {
  const tenant = requireTenant()
  if (initializedTenants.has(tenant.ownerKey)) return
  await Unit.bulkWrite(DEFAULT_UNITS.map(([name, code, symbol, category]) => ({
    updateOne: {
      filter: { ownerKey: tenant.ownerKey, code },
      update: {
        $setOnInsert: {
          ownerKey: tenant.ownerKey,
          ownerEmail: tenant.ownerEmail,
          name,
          code,
          symbol,
          category,
          allowDecimals: !['piece', 'box', 'bag', 'batch'].includes(code),
          active: true,
          createdBy: auditActor(),
          updatedBy: auditActor(),
        },
      },
      upsert: true,
    },
  })))
  initializedTenants.add(tenant.ownerKey)
}

async function listUnits() {
  const tenant = requireTenant()
  await ensureDefaultUnits()
  return Unit.find({ ownerKey: tenant.ownerKey }).sort({ active: -1, name: 1 }).lean()
}

async function createUnit(payload = {}) {
  const tenant = requireTenant()
  await ensureDefaultUnits()
  const unit = normalizeUnit(payload)
  if (await Unit.findOne({ ownerKey: tenant.ownerKey, code: unit.code }).lean()) {
    throw httpError(409, 'A unit with this code already exists')
  }
  const created = await Unit.create({
    ...unit,
    ownerKey: tenant.ownerKey,
    ownerEmail: tenant.ownerEmail,
    createdBy: auditActor(),
    updatedBy: auditActor(),
  })
  return created.toObject()
}

async function updateUnit(code, payload = {}) {
  const tenant = requireTenant()
  await ensureDefaultUnits()
  const unit = await Unit.findOne({ ownerKey: tenant.ownerKey, code: normalizeUnitCode(code) })
  if (!unit) throw httpError(404, 'Unit not found')
  const next = normalizeUnit({ ...unit.toObject(), ...payload }, unit.toObject())
  if (next.code !== unit.code) throw httpError(400, 'A unit code cannot be changed after creation')
  Object.assign(unit, next, { updatedBy: auditActor() })
  await unit.save()
  return unit.toObject()
}

async function assertUnitExists(code) {
  const tenant = requireTenant()
  await ensureDefaultUnits()
  const normalized = normalizeUnitCode(code)
  const unit = await Unit.findOne({ ownerKey: tenant.ownerKey, code: normalized, active: { $ne: false } }).lean()
  if (!unit) throw httpError(400, `Choose an active unit for ${code || 'this item'}`)
  return unit
}

async function listConversions(productSku = '') {
  const tenant = requireTenant()
  await ensureDefaultUnits()
  const filter = { ownerKey: tenant.ownerKey }
  if (productSku) filter.productSku = normalizeSku(productSku)
  return UnitConversion.find(filter).sort({ productSku: 1, fromUnit: 1, toUnit: 1 }).lean()
}

async function createConversion(payload = {}) {
  const tenant = requireTenant()
  await ensureDefaultUnits()
  const conversion = normalizeConversion(payload)
  await Promise.all([assertUnitExists(conversion.fromUnit), assertUnitExists(conversion.toUnit)])
  await validateNoCircularRule(conversion)
  try {
    const created = await UnitConversion.create({
      ...conversion,
      ownerKey: tenant.ownerKey,
      ownerEmail: tenant.ownerEmail,
      createdBy: auditActor(),
      updatedBy: auditActor(),
    })
    return created.toObject()
  } catch (error) {
    if (error?.code === 11000) throw httpError(409, 'A conversion for those units already exists')
    throw error
  }
}

async function updateConversion(id, payload = {}) {
  const tenant = requireTenant()
  const conversion = await UnitConversion.findOne({ ownerKey: tenant.ownerKey, _id: id })
  if (!conversion) throw httpError(404, 'Conversion rule not found')
  const next = normalizeConversion({ ...conversion.toObject(), ...payload })
  await Promise.all([assertUnitExists(next.fromUnit), assertUnitExists(next.toUnit)])
  await validateNoCircularRule(next, String(conversion._id))
  Object.assign(conversion, next, { updatedBy: auditActor() })
  try {
    await conversion.save()
  } catch (error) {
    if (error?.code === 11000) throw httpError(409, 'A conversion for those units already exists')
    throw error
  }
  return conversion.toObject()
}

async function convertQuantity({ quantity, fromUnit, toUnit, productSku = '' }) {
  const parsedQuantity = Number(quantity)
  if (!Number.isFinite(parsedQuantity) || parsedQuantity < 0) {
    throw httpError(400, 'Quantity must be a valid non-negative number')
  }
  const from = normalizeUnitCode(fromUnit)
  const to = normalizeUnitCode(toUnit)
  if (!from || !to) throw httpError(400, 'Both source and target units are required')
  if (from === to) return { quantity: round(parsedQuantity), factor: 1, path: [from] }

  const rules = await conversionRulesFor(normalizeSku(productSku))
  const path = findConversionPath(rules, from, to)
  if (!path) {
    throw httpError(400, `No conversion rule exists from ${from} to ${to}${productSku ? ` for ${productSku}` : ''}`)
  }
  return { quantity: round(parsedQuantity * path.factor), factor: path.factor, path: path.units }
}

async function convertItemQuantity(item, quantity, sourceUnit) {
  const targetUnit = normalizeUnitCode(item?.baseUnit || sourceUnit)
  return convertQuantity({
    quantity,
    fromUnit: sourceUnit || targetUnit,
    toUnit: targetUnit,
    productSku: item?.sku || '',
  })
}

async function validateNoCircularRule(candidate, excludedId = '') {
  if (candidate.fromUnit === candidate.toUnit) throw httpError(400, 'Source and target units must be different')
  const rules = await conversionRulesForScope(candidate.productSku, excludedId)
  if (findConnectedPath(rules, candidate.fromUnit, candidate.toUnit)) {
    throw httpError(400, 'This conversion would create a circular conversion rule')
  }
}

async function conversionRulesFor(productSku, excludedId = '') {
  const tenant = requireTenant()
  const filter = {
    ownerKey: tenant.ownerKey,
    active: { $ne: false },
    ...(excludedId ? { _id: { $ne: excludedId } } : {}),
    ...(productSku ? { $or: [{ productSku: '' }, { productSku }] } : { productSku: '' }),
  }
  return UnitConversion.find(filter).lean()
}

async function conversionRulesForScope(productSku, excludedId = '') {
  const tenant = requireTenant()
  return UnitConversion.find({
    ownerKey: tenant.ownerKey,
    productSku: productSku || '',
    active: { $ne: false },
    ...(excludedId ? { _id: { $ne: excludedId } } : {}),
  }).lean()
}

function findConnectedPath(rules, from, to) {
  const edges = new Map()
  rules.forEach((rule) => {
    addEdge(edges, rule.fromUnit, rule.toUnit, Number(rule.factor))
    addEdge(edges, rule.toUnit, rule.fromUnit, 1 / Number(rule.factor))
  })
  const queue = [from]
  const visited = new Set([from])
  while (queue.length) {
    const current = queue.shift()
    if (current === to) return true
    for (const edge of edges.get(current) || []) {
      if (!visited.has(edge.unit)) {
        visited.add(edge.unit)
        queue.push(edge.unit)
      }
    }
  }
  return false
}

function findConversionPath(rules, from, to) {
  const byEdge = new Map()
  const ordered = [...rules.filter((rule) => rule.productSku), ...rules.filter((rule) => !rule.productSku)]
  ordered.forEach((rule) => {
    const key = `${rule.fromUnit}:${rule.toUnit}`
    if (!byEdge.has(key)) byEdge.set(key, { from: rule.fromUnit, to: rule.toUnit, factor: Number(rule.factor) })
  })

  const edges = new Map()
  byEdge.forEach((rule) => {
    addEdge(edges, rule.from, rule.to, rule.factor)
    addEdge(edges, rule.to, rule.from, 1 / rule.factor)
  })
  const queue = [{ unit: from, factor: 1, units: [from] }]
  const visited = new Set([from])
  while (queue.length) {
    const current = queue.shift()
    if (current.unit === to) return current
    for (const edge of edges.get(current.unit) || []) {
      if (!visited.has(edge.unit)) {
        visited.add(edge.unit)
        queue.push({ unit: edge.unit, factor: current.factor * edge.factor, units: [...current.units, edge.unit] })
      }
    }
  }
  return null
}

function addEdge(edges, from, to, factor) {
  const list = edges.get(from) || []
  list.push({ unit: to, factor })
  edges.set(from, list)
}

function normalizeUnit(payload = {}, fallback = {}) {
  const name = String(payload.name ?? fallback.name ?? '').trim()
  const code = normalizeUnitCode(payload.code ?? fallback.code ?? name)
  if (!name || !code) throw httpError(400, 'Unit name and code are required')
  return {
    name,
    code,
    symbol: String(payload.symbol ?? fallback.symbol ?? code).trim(),
    category: String(payload.category ?? fallback.category ?? 'count').trim().toLowerCase(),
    allowDecimals: payload.allowDecimals === undefined ? fallback.allowDecimals !== false : Boolean(payload.allowDecimals),
    active: payload.active === undefined ? fallback.active !== false : Boolean(payload.active),
  }
}

function normalizeConversion(payload = {}) {
  const fromUnit = normalizeUnitCode(payload.fromUnit)
  const toUnit = normalizeUnitCode(payload.toUnit)
  const factor = Number(payload.factor)
  if (!fromUnit || !toUnit || !Number.isFinite(factor) || factor <= 0) {
    throw httpError(400, 'Source unit, target unit, and a positive conversion factor are required')
  }
  return {
    productSku: normalizeSku(payload.productSku),
    fromUnit,
    toUnit,
    factor,
    description: String(payload.description || '').trim(),
    active: payload.active === undefined ? true : Boolean(payload.active),
  }
}

function normalizeUnitCode(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '')
}

function normalizeSku(value) {
  return String(value || '').trim().toUpperCase()
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1e8) / 1e8
}

function requireTenant() {
  const tenant = currentTenant()
  if (!tenant.ownerKey) throw httpError(403, 'Select a business before managing units')
  return tenant
}

module.exports = {
  assertUnitExists,
  convertItemQuantity,
  convertQuantity,
  createConversion,
  createUnit,
  ensureDefaultUnits,
  findConnectedPath,
  listConversions,
  listUnits,
  normalizeUnitCode,
  findConversionPath,
  updateConversion,
  updateUnit,
}

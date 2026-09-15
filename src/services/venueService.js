const Venue = require('../models/Venue')
const storeModel = require('../models/storeModel')
const httpError = require('../utils/httpError')
const CacheManager = require('../utils/cache')
const { required } = require('../utils/validation')

/**
 * List venues with pagination, filtering, and caching
 */
async function listVenues({ page = 1, limit = 50, type = '', status = '' } = {}) {
  await storeModel.ensureStore()
  const pageNum = Math.max(1, parseInt(page, 10) || 1)
  const limitNum = Math.min(1000, Math.max(1, parseInt(limit, 10) || 50))

  const cacheKey = `venues:list:${pageNum}:${limitNum}:${type}:${status}`
  const cached = CacheManager.get(cacheKey)
  if (cached) {
    return cached
  }

  let query = Venue.find(storeModel.tenantFilter())

  if (type) {
    query = query.where('type').equals(type)
  }

  if (status) {
    query = query.where('status').equals(status)
  }

  const totalCount = await Venue.countDocuments(query.getFilter())
  const totalPages = Math.ceil(totalCount / limitNum)

  const venues = await query
    .sort({ createdAt: -1 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum)
    .lean()

  const result = {
    rows: venues,
    count: totalCount,
    page: pageNum,
    pageSize: limitNum,
    totalPages,
    hasNextPage: pageNum < totalPages,
    hasPrevPage: pageNum > 1,
  }

  CacheManager.set(cacheKey, result, 60000)
  return result
}

/**
 * Get a single venue by code
 */
async function getVenue(code) {
  await storeModel.ensureStore()
  const cacheKey = `venue:${code}`
  const cached = CacheManager.get(cacheKey)
  if (cached) {
    return cached
  }

  const venue = await Venue.findOne({ ...storeModel.tenantFilter(), code }).lean()
  if (!venue) throw httpError(404, 'Venue not found')

  CacheManager.set(cacheKey, venue, 60000)
  return venue
}

/**
 * Create a new venue
 */
async function createVenue(body) {
  await storeModel.ensureStore()
  const missing = required(body, ['name', 'code', 'type'])
  if (missing.length) throw httpError(400, 'Missing required fields', { fields: missing })

  // Check for duplicates
  const existing = await Venue.findOne(storeModel.scopedQuery({ $or: [{ name: body.name }, { code: body.code }] }))
  if (existing) {
    throw httpError(409, `Venue with name or code already exists`)
  }

  const venue = new Venue(storeModel.withTenantFields({
    name: body.name,
    code: body.code.toUpperCase(),
    type: body.type || 'Warehouse',
    location: body.location || '',
    address: body.address || '',
    capacity: body.capacity || 1000,
    manager: body.manager || '',
    contact: body.contact || '',
    status: body.status || 'Active',
    notes: body.notes || '',
  }))

  await venue.save()

  // Clear list cache
  CacheManager.clear()

  return venue.toObject()
}

/**
 * Update a venue
 */
async function updateVenue(code, body) {
  await storeModel.ensureStore()
  const venue = await Venue.findOne({ ...storeModel.tenantFilter(), code })
  if (!venue) throw httpError(404, 'Venue not found')

  // Check if new code/name already exists
  if (body.code && body.code !== code) {
    const existing = await Venue.findOne({ ...storeModel.tenantFilter(), code: body.code })
    if (existing) throw httpError(409, 'Venue code already exists')
  }

  if (body.name) {
    const existing = await Venue.findOne({ ...storeModel.tenantFilter(), name: body.name, _id: { $ne: venue._id } })
    if (existing) throw httpError(409, 'Venue name already exists')
  }

  // Update fields
  if (body.name) venue.name = body.name
  if (body.code) venue.code = body.code.toUpperCase()
  if (body.type) venue.type = body.type
  if (body.location) venue.location = body.location
  if (body.address) venue.address = body.address
  if (body.capacity !== undefined) venue.capacity = body.capacity
  if (body.manager) venue.manager = body.manager
  if (body.contact) venue.contact = body.contact
  if (body.status) venue.status = body.status
  if (body.notes) venue.notes = body.notes

  await venue.save()

  // Clear cache
  CacheManager.delete(`venue:${code}`)
  CacheManager.clear()

  return venue.toObject()
}

/**
 * Delete a venue
 */
async function deleteVenue(code) {
  await storeModel.ensureStore()
  const result = await Venue.deleteOne({ ...storeModel.tenantFilter(), code })
  if (result.deletedCount === 0) throw httpError(404, 'Venue not found')

  // Clear cache
  CacheManager.delete(`venue:${code}`)
  CacheManager.clear()

  return { success: true }
}

module.exports = {
  listVenues,
  getVenue,
  createVenue,
  updateVenue,
  deleteVenue,
}

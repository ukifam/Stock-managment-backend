const Business = require('../models/Business')
const httpError = require('../utils/httpError')
const { currentTenant } = require('../utils/tenantContext')
const { businessFeatures } = require('../utils/businessFeatures')

async function processingBusinessMiddleware(_req, _res, next) {
  try {
    const { ownerKey } = currentTenant()
    if (!ownerKey) throw httpError(403, 'Select a business before opening processing features')
    const business = await Business.findOne({ ownerKey }).select('template processingEnabled').lean()
    if (!businessFeatures(business?.template, business?.processingEnabled).processing) {
      throw httpError(403, 'Processing features are available only to processing businesses')
    }
    next()
  } catch (error) {
    next(error)
  }
}

module.exports = { processingBusinessMiddleware }

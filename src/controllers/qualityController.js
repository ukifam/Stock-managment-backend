const qualityService = require('../services/qualityService')

async function getOverview(_req, res, next) {
  try { res.json(await qualityService.getOverview()) } catch (error) { next(error) }
}

async function createStandard(req, res, next) {
  try { res.status(201).json(await qualityService.createStandard(req.body)) } catch (error) { next(error) }
}

async function updateStandard(req, res, next) {
  try { res.json(await qualityService.updateStandard(req.params.id, req.body)) } catch (error) { next(error) }
}

async function createInspection(req, res, next) {
  try { res.status(201).json(await qualityService.createInspection(req.body)) } catch (error) { next(error) }
}

async function setDisposition(req, res, next) {
  try { res.json(await qualityService.setDisposition(req.params.id, req.body)) } catch (error) { next(error) }
}

module.exports = { createInspection, createStandard, getOverview, setDisposition, updateStandard }

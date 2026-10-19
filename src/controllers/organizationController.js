const businessService = require('../services/businessService')

async function getOrganization(_req, res, next) {
  try {
    res.json(await businessService.getOrganization())
  } catch (error) {
    next(error)
  }
}

async function updateBusiness(req, res, next) {
  try {
    res.json(await businessService.updateBusiness(req.body))
  } catch (error) {
    next(error)
  }
}

async function createBranch(req, res, next) {
  try {
    res.status(201).json(await businessService.createBranch(req.body))
  } catch (error) {
    next(error)
  }
}

async function updateBranch(req, res, next) {
  try {
    res.json(await businessService.updateBranch(req.params.code, req.body))
  } catch (error) {
    next(error)
  }
}

async function assignUserBranches(req, res, next) {
  try {
    res.json(await businessService.assignUserBranches(req.params.id, req.body))
  } catch (error) {
    next(error)
  }
}

module.exports = { assignUserBranches, createBranch, getOrganization, updateBranch, updateBusiness }

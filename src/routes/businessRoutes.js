const router = require('express').Router()
const businessService = require('../services/businessService')

router.get('/features', async (_req, res, next) => {
  try {
    res.json(await businessService.getBusinessFeatures())
  } catch (error) {
    next(error)
  }
})

module.exports = router

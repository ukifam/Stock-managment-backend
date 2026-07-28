const venueService = require('../services/venueService')

async function listVenues(req, res) {
  res.json(await venueService.listVenues(req.query))
}

async function getVenue(req, res) {
  res.json(await venueService.getVenue(req.params.code))
}

async function createVenue(req, res) {
  res.status(201).json(await venueService.createVenue(req.body))
}

async function updateVenue(req, res) {
  res.json(await venueService.updateVenue(req.params.code, req.body))
}

async function deleteVenue(req, res) {
  res.json(await venueService.deleteVenue(req.params.code))
}

module.exports = {
  listVenues,
  getVenue,
  createVenue,
  updateVenue,
  deleteVenue,
}

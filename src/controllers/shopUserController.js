const shopUserService = require('../services/shopUserService')

async function listUsers(_req, res) {
  res.json(await shopUserService.listUsers())
}

async function createUser(req, res) {
  res.status(201).json(await shopUserService.createUser(req.body))
}

async function updateUser(req, res) {
  res.json(await shopUserService.updateUser(req.params.id, req.body))
}

module.exports = { listUsers, createUser, updateUser }

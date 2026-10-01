const adminService = require('../services/adminService')

async function overview(_req, res) {
  res.json(await adminService.getAdminOverview())
}

async function listUsers(_req, res) {
  res.json(await adminService.listUsers())
}

async function createUser(req, res) {
  res.status(201).json(await adminService.createUser(req.body))
}

async function updateUser(req, res) {
  res.json(await adminService.updateUser(req.params.id, req.body, req.user.id))
}

module.exports = { overview, listUsers, createUser, updateUser }
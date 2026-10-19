const accessRoleService = require('../services/accessRoleService')

async function listRoles(_req, res, next) {
  try { res.json(await accessRoleService.listRoles()) } catch (error) { next(error) }
}

async function createRole(req, res, next) {
  try { res.status(201).json(await accessRoleService.createRole(req.body)) } catch (error) { next(error) }
}

async function updateRole(req, res, next) {
  try { res.json(await accessRoleService.updateRole(req.params.code, req.body)) } catch (error) { next(error) }
}

module.exports = { createRole, listRoles, updateRole }

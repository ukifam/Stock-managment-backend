const service = require('../services/branchTransferService')

async function listTransfers(req, res) {
  res.json(await service.listBranchTransfers(req.query))
}

async function sendTransfer(req, res) {
  res.status(201).json(await service.sendBranchTransfer(req.body))
}

async function receiveTransfer(req, res) {
  res.json(await service.receiveBranchTransfer(req.params.id, req.body))
}

async function cancelTransfer(req, res) {
  res.json(await service.cancelBranchTransfer(req.params.id))
}

module.exports = { cancelTransfer, listTransfers, receiveTransfer, sendTransfer }

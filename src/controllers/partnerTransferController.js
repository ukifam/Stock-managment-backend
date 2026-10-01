const partnerTransferService = require('../services/partnerTransferService')

async function listTransfers(req, res) {
  res.json(await partnerTransferService.listTransfers(req.query))
}

async function receiveTransfer(req, res) {
  res.status(201).json(await partnerTransferService.receivePartnerStock(req.body))
}

async function sellTransfer(req, res) {
  res.status(201).json(await partnerTransferService.sellTransferredStock(req.params.id, req.body))
}

async function returnTransfer(req, res) {
  res.status(201).json(await partnerTransferService.returnTransferredStock(req.params.id, req.body))
}

module.exports = { listTransfers, receiveTransfer, sellTransfer, returnTransfer }
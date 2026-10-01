const PartnerTransfer = require('../models/PartnerTransfer')
const storeModel = require('../models/storeModel')
const httpError = require('../utils/httpError')
const CacheManager = require('../utils/cache')

async function listTransfers({ status = 'ALL', search = '' } = {}) {
  const query = {}
  if (status !== 'ALL') query.status = status
  if (search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    query.$or = [
      { reference: { $regex: escaped, $options: 'i' } },
      { partner: { $regex: escaped, $options: 'i' } },
      { item: { $regex: escaped, $options: 'i' } },
      { sku: { $regex: escaped, $options: 'i' } },
    ]
  }
  const rows = await PartnerTransfer.find(storeModel.scopedQuery(query)).sort({ createdAt: -1 }).lean()
  return {
    rows: rows.map(withBalance),
    count: rows.length,
    openCount: rows.filter((row) => row.status === 'OPEN').length,
  }
}

async function receivePartnerStock(body = {}) {
  const partner = String(body.partner || '').trim()
  const item = String(body.item || '').trim()
  const quantityReceived = Number(body.quantityReceived)
  const partnerUnitCost = Number(body.partnerUnitCost)
  const customerUnitPrice = Number(body.customerUnitPrice)
  if (!partner || !item) throw httpError(400, 'Partner and item name are required')
  if (!Number.isInteger(quantityReceived) || quantityReceived <= 0) throw httpError(400, 'Quantity must be a positive whole number')
  if (!Number.isFinite(partnerUnitCost) || partnerUnitCost < 0) throw httpError(400, 'Partner unit cost must be zero or greater')
  if (!Number.isFinite(customerUnitPrice) || customerUnitPrice <= 0) throw httpError(400, 'Customer selling price must be greater than zero')

  const reference = `TR-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
  const transfer = await PartnerTransfer.create({
    ...storeModel.withTenantFields({
      reference,
      partner,
      partnerPhone: String(body.partnerPhone || '').trim(),
      sku: String(body.sku || '').trim(),
      item,
      category: String(body.category || 'General').trim(),
      quantityReceived,
      partnerUnitCost,
      customerUnitPrice,
      receivedDate: body.receivedDate || new Date().toISOString().slice(0, 10),
      notes: String(body.notes || '').trim(),
    }),
  })
  CacheManager.clear()
  return withBalance(transfer.toObject())
}

async function sellTransferredStock(id, body = {}) {
  const quantity = Number(body.quantity)
  const customer = String(body.customer || '').trim()
  if (!Number.isInteger(quantity) || quantity <= 0) throw httpError(400, 'Sale quantity must be a positive whole number')
  if (!customer) throw httpError(400, 'Customer name is required')

  const scope = storeModel.scopedQuery({ _id: id, status: 'OPEN' })
  const transfer = await PartnerTransfer.findOneAndUpdate(
    {
      ...scope,
      $expr: { $lte: [{ $add: ['$quantitySold', '$quantityReturned', quantity] }, '$quantityReceived'] },
    },
    { $inc: { quantitySold: quantity } },
    { new: true, runValidators: true },
  )
  if (!transfer) throw httpError(400, 'Transfer is closed or does not have enough available quantity')

  const unitPrice = body.unitPrice === undefined || body.unitPrice === ''
    ? Number(transfer.customerUnitPrice)
    : Number(body.unitPrice)
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    await PartnerTransfer.updateOne(scope, { $inc: { quantitySold: -quantity } })
    throw httpError(400, 'Customer unit price must be greater than zero')
  }

  try {
    const saleService = require('./saleService')
    const sale = await saleService.createSale({
      customer,
      date: body.date || new Date().toISOString().slice(0, 10),
      reference: transfer.reference,
      item: transfer.item,
      sku: transfer.sku || `TRANSFER-${transfer.reference}`,
      category: transfer.category || 'Partner Transfer',
      quantity,
      unitPrice,
      total: quantity * unitPrice,
      payment: body.payment || 'Cash',
      paidAmount: body.paidAmount,
      user: body.user || 'Transfer Sale',
    }, {
      stockAlreadyDeducted: true,
      allowExternalItem: true,
      partnerUnitCost: Number(transfer.partnerUnitCost),
    })
    const saleRecord = {
      saleId: sale.id,
      customer,
      quantity,
      unitPrice,
      date: body.date || new Date().toISOString().slice(0, 10),
    }
    const updated = await PartnerTransfer.findOneAndUpdate(scope, {
      $push: { sales: saleRecord },
      $set: { status: transfer.quantityReceived === transfer.quantitySold + transfer.quantityReturned ? 'CLOSED' : 'OPEN' },
    }, { new: true })
    CacheManager.clear()
    return { transfer: withBalance(updated.toObject()), sale }
  } catch (error) {
    await PartnerTransfer.updateOne(scope, { $inc: { quantitySold: -quantity } })
    throw error
  }
}

async function returnTransferredStock(id, body = {}) {
  const quantity = Number(body.quantity)
  if (!Number.isInteger(quantity) || quantity <= 0) throw httpError(400, 'Return quantity must be a positive whole number')
  const scope = storeModel.scopedQuery({ _id: id, status: 'OPEN' })
  const updated = await PartnerTransfer.findOneAndUpdate(
    {
      ...scope,
      $expr: { $lte: [{ $add: ['$quantitySold', '$quantityReturned', quantity] }, '$quantityReceived'] },
    },
    {
      $inc: { quantityReturned: quantity },
      $push: { returns: { quantity, date: body.date || new Date().toISOString().slice(0, 10), notes: String(body.notes || '').trim() } },
    },
    { new: true, runValidators: true },
  )
  if (!updated) throw httpError(400, 'Transfer is closed or does not have enough available quantity to return')
  const transfer = withBalance(updated.toObject())
  if (transfer.remainingQuantity === 0) {
    transfer.status = 'CLOSED'
    await PartnerTransfer.updateOne(scope, { $set: { status: 'CLOSED' } })
  }
  CacheManager.clear()
  return transfer
}

function withBalance(transfer) {
  const quantityReceived = Number(transfer.quantityReceived || 0)
  const quantitySold = Number(transfer.quantitySold || 0)
  const quantityReturned = Number(transfer.quantityReturned || 0)
  const remainingQuantity = quantityReceived - quantitySold - quantityReturned
  return {
    ...transfer,
    remainingQuantity,
    totalPartnerCost: quantityReceived * Number(transfer.partnerUnitCost || 0),
    totalPotentialRevenue: quantityReceived * Number(transfer.customerUnitPrice || 0),
    realizedRevenue: (transfer.sales || []).reduce((sum, sale) => sum + Number(sale.quantity || 0) * Number(sale.unitPrice || 0), 0),
    status: remainingQuantity === 0 ? 'CLOSED' : 'OPEN',
  }
}

module.exports = {
  listTransfers,
  receivePartnerStock,
  sellTransferredStock,
  returnTransferredStock,
}

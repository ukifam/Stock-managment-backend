const masterDataService = require('../services/masterDataService')
const unitConversionService = require('../services/unitConversionService')
const warehouseStockService = require('../services/warehouseStockService')

function respond(service, status = 200) {
  return async (req, res, next) => {
    try {
      const result = await service(req)
      res.status(status).json(result)
    } catch (error) {
      next(error)
    }
  }
}

module.exports = {
  getMasterData: respond(() => masterDataService.getMasterData()),
  listUnits: respond(() => unitConversionService.listUnits()),
  createUnit: respond((req) => unitConversionService.createUnit(req.body), 201),
  updateUnit: respond((req) => unitConversionService.updateUnit(req.params.code, req.body)),
  listConversions: respond((req) => unitConversionService.listConversions(req.query.productSku)),
  createConversion: respond((req) => unitConversionService.createConversion(req.body), 201),
  updateConversion: respond((req) => unitConversionService.updateConversion(req.params.id, req.body)),
  listSuppliers: respond(() => masterDataService.listSuppliers()),
  createSupplier: respond((req) => masterDataService.createSupplier(req.body), 201),
  updateSupplier: respond((req) => masterDataService.updateSupplier(req.params.id, req.body)),
  listCustomers: respond(() => masterDataService.listCustomers()),
  createCustomer: respond((req) => masterDataService.createCustomer(req.body), 201),
  updateCustomer: respond((req) => masterDataService.updateCustomer(req.params.id, req.body)),
  createItem: respond((req) => masterDataService.createItem(req.body), 201),
  updateItem: respond((req) => masterDataService.updateItem(req.params.sku, req.body)),
  listWarehouses: respond(() => warehouseStockService.listWarehouses()),
  createWarehouse: respond((req) => warehouseStockService.createWarehouse(req.body), 201),
  updateWarehouse: respond((req) => warehouseStockService.updateWarehouse(req.params.code, req.body)),
  listStock: respond(() => warehouseStockService.listBalances()),
  recordStockOperation: respond((req) => warehouseStockService.recordStockOperation(req.body), 201),
}

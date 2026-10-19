const test = require('node:test')
const assert = require('node:assert/strict')
const { calculateProductionPlan, calculateWasteMetrics } = require('../src/utils/productionCalculator')

test('production planning scales recipe requirements, shortages, and complete costs', () => {
  const recipe = {
    productSku: 'FLOUR-1KG',
    productName: 'Maize Flour 1kg',
    productUnit: 'bag',
    yieldQuantity: 100,
    materials: [
      { sku: 'MAIZE', item: 'Maize grain', quantity: 1.4, unit: 'kg', wastePercent: 0 },
      { sku: 'BAG', item: 'Packaging bag', quantity: 1, unit: 'piece', wastePercent: 0 },
    ],
    labor: [{ name: 'Miller', hoursPerBatch: 4 }],
    machines: [{ name: 'Mill', hoursPerBatch: 3 }],
    utilities: [{ name: 'Electricity', quantityPerBatch: 20 }],
    processSteps: [{ name: 'Milling', durationHours: 3 }, { name: 'Packing', durationHours: 1 }],
  }
  const inventory = [
    { sku: 'MAIZE', stock: 200, price: 300 },
    { sku: 'BAG', stock: 1, price: 40 },
  ]
  const configuration = {
    workers: [{ name: 'Miller', hourlyRate: 500 }],
    machines: [{ name: 'Mill', hourlyRate: 800 }],
    utilities: [{ name: 'Electricity', unit: 'kWh', rate: 100 }],
    overheadRatePerUnit: 15,
  }

  const plan = calculateProductionPlan(recipe, inventory, configuration, 200)

  assert.equal(plan.batches, 2)
  assert.equal(plan.requirements[0].requiredQuantity, 2.8)
  assert.equal(plan.requirements[1].shortageQuantity, 1)
  assert.equal(plan.materialsReady, false)
  assert.equal(plan.durationHours, 8)
  assert.equal(plan.cost.material, 920)
  assert.equal(plan.cost.labor, 4000)
  assert.equal(plan.cost.machine, 4800)
  assert.equal(plan.cost.utility, 4000)
  assert.equal(plan.cost.overhead, 3000)
  assert.equal(plan.cost.total, 16720)
  assert.equal(plan.cost.unit, 83.6)
})

test('material planning subtracts reservations, includes confirmed incoming stock, and flags purchase needs', () => {
  const plan = calculateProductionPlan({
    productSku: 'BREAD',
    productName: 'Bread',
    productUnit: 'piece',
    yieldQuantity: 1,
    materials: [
      { sku: 'FLOUR', item: 'Flour', quantity: 8, unit: 'kg', wastePercent: 0 },
      { sku: 'YEAST', item: 'Yeast', quantity: 5, unit: 'g', wastePercent: 0 },
    ],
  }, [
    { sku: 'FLOUR', stock: 10, onHand: 10, reserved: 4, incoming: 2, price: 1 },
    { sku: 'YEAST', stock: 0, onHand: 0, reserved: 0, incoming: 2, price: 1 },
  ], {}, 1)

  assert.equal(plan.requirements[0].availableQuantity, 6)
  assert.equal(plan.requirements[0].projectedAvailableQuantity, 8)
  assert.equal(plan.requirements[0].shortageQuantity, 0)
  assert.equal(plan.requirements[0].availabilityStatus, 'PARTIALLY_AVAILABLE')
  assert.equal(plan.requirements[1].shortageQuantity, 3)
  assert.equal(plan.requirements[1].availabilityStatus, 'PURCHASE_REQUIRED')
  assert.equal(plan.materialsReady, false)
})

test('production steps add their required inputs while optional steps stay out of the base plan', () => {
  const plan = calculateProductionPlan({
    productSku: 'JUICE',
    productName: 'Juice',
    productUnit: 'bottle',
    yieldQuantity: 10,
    materials: [{ sku: 'FRUIT', item: 'Fruit', quantity: 5, unit: 'kg' }],
    processSteps: [
      { name: 'Bottle', durationHours: 1, materials: [{ sku: 'BOTTLE', item: 'Bottle', quantity: 10, unit: 'piece', materialType: 'packaging' }] },
      { name: 'Rework', durationHours: 2, optional: true, materials: [{ sku: 'EXTRA', item: 'Extra fruit', quantity: 1, unit: 'kg' }] },
    ],
  }, [
    { sku: 'FRUIT', stock: 10, price: 2 },
    { sku: 'BOTTLE', stock: 30, price: 1 },
    { sku: 'EXTRA', stock: 10, price: 1 },
  ], {}, 20)

  assert.equal(plan.requirements.length, 2)
  assert.equal(plan.requirements.find((row) => row.sku === 'BOTTLE').requiredQuantity, 20)
  assert.equal(plan.requirements.find((row) => row.sku === 'BOTTLE').materialType, 'packaging')
  assert.equal(plan.durationHours, 2)
})

test('production costing separates packaging and applies resource, transport, and overhead allocation methods', () => {
  const plan = calculateProductionPlan({
    productSku: 'COOKIES', productName: 'Cookies', productUnit: 'box', yieldQuantity: 10,
    materials: [
      { sku: 'DOUGH', item: 'Dough', quantity: 1, unit: 'kg' },
      { sku: 'BOX', item: 'Box', quantity: 2, unit: 'piece', materialType: 'packaging' },
    ],
    labor: [{ name: 'Baker', hoursPerBatch: 2 }],
    machines: [{ name: 'Oven', hoursPerBatch: 1 }],
  }, [
    { sku: 'DOUGH', stock: 10, price: 3 },
    { sku: 'BOX', stock: 40, price: 1 },
  ], {
    workers: [{ name: 'Baker', rateType: 'daily', rate: 80 }],
    machines: [{ name: 'Oven', costingMethod: 'depreciation', purchasePrice: 17600, usefulLifeYears: 1 }],
    transportCostPerBatch: 5,
    overheadRatePerUnit: 1,
    overheadCosts: [{ name: 'Rent', amount: 7, allocationMethod: 'per_batch' }, { name: 'Admin', amount: 3, allocationMethod: 'fixed' }],
  }, 20)

  assert.equal(plan.cost.material, 10)
  assert.equal(plan.cost.packaging, 4)
  assert.equal(plan.cost.labor, 40)
  assert.equal(plan.cost.machine, 16.6667)
  assert.equal(plan.cost.transport, 10)
  assert.equal(plan.cost.overhead, 37)
})

test('expected waste uses total planned material input and combines recipe and process-step loss', () => {
  const plan = calculateProductionPlan({
    productSku: 'JUICE',
    productName: 'Juice',
    productUnit: 'bottle',
    yieldQuantity: 10,
    expectedWastePercent: 10,
    materials: [{ sku: 'FRUIT', item: 'Fruit', quantity: 5, unit: 'kg' }],
    processSteps: [{ name: 'Press', expectedWastePercent: 5, materials: [{ sku: 'WATER', item: 'Water', quantity: 2, unit: 'litre' }] }],
  }, [], {}, 20)

  assert.equal(plan.totalMaterialInputQuantity, 14)
  assert.equal(plan.expectedWastePercent, 14.5)
  assert.equal(plan.expectedWasteQuantity, 2.03)
})

test('material waste allowance is calculated and included in scaled requirements', () => {
  const plan = calculateProductionPlan({
    productSku: 'BREAD',
    productName: 'Bread',
    productUnit: 'loaf',
    yieldQuantity: 1,
    materials: [{ sku: 'FLOUR', item: 'Flour', quantity: 0.5, unit: 'kg', wastePercent: 10 }],
  }, [], {}, 4)

  assert.equal(plan.requirements[0].baseRequiredQuantity, 2)
  assert.equal(plan.requirements[0].wasteQuantity, 0.2)
  assert.equal(plan.requirements[0].requiredQuantity, 2.2)
})

test('single-product recipe inputs scale to the requested number of finished units', () => {
  const plan = calculateProductionPlan({
    productSku: 'COFFEE',
    productName: 'Cup of coffee',
    productUnit: 'cup',
    yieldQuantity: 1,
    materials: [
      { sku: 'WATER', item: 'Water', quantity: 0.5, unit: 'cup' },
      { sku: 'MILK', item: 'Milk', quantity: 0.5, unit: 'cup' },
      { sku: 'SUGAR', item: 'Sugar', quantity: 3, unit: 'spoon' },
      { sku: 'COFFEE', item: 'Coffee', quantity: 2, unit: 'spoon' },
    ],
  }, [], {}, 100)

  assert.deepEqual(plan.requirements.map((row) => row.requiredQuantity), [50, 50, 300, 200])
})

test('labor hours, shift staffing, and labor cost are estimated from per-worker step capacity', () => {
  const plan = calculateProductionPlan({
    productSku: 'COFFEE',
    productName: 'Cup of coffee',
    productUnit: 'cup',
    yieldQuantity: 1,
    materials: [{ sku: 'COFFEE-MIX', item: 'Coffee mix', quantity: 1, unit: 'cup' }],
    processSteps: [
      { name: 'Prepare', capacityPerHour: 20 },
      { name: 'Serve', capacityPerHour: 10 },
    ],
  }, [], {
    workers: [
      { name: 'Barista', rateType: 'hourly', rate: 500, availableHoursPerDay: 8, active: true },
      { name: 'Inactive worker', rateType: 'hourly', rate: 1000, availableHoursPerDay: 8, active: false },
    ],
  }, 100)

  assert.equal(plan.laborEstimate.workerHours, 15)
  assert.equal(plan.laborEstimate.workersRequired, 2)
  assert.equal(plan.laborEstimate.shiftHours, 8)
  assert.equal(plan.laborEstimate.averageHourlyRate, 500)
  assert.equal(plan.cost.labor, 7500)
})

test('actual waste percentage uses total actual material input', () => {
  assert.deepEqual(calculateWasteMetrics(40, 12.5, 3), {
    totalMaterialInputQuantity: 40,
    expectedWasteQuantity: 5,
    actualWasteQuantity: 3,
    actualWastePercent: 7.5,
  })
})

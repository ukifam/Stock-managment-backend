const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeStage, planFields, serializePipeline } = require('../src/services/pipelineWorkflowService')
const { isFinishedProduct, matchByName } = require('../src/utils/inventoryMatch')

test('old 11-step pipelines map onto the new order flow', () => {
  assert.equal(normalizeStage('receive_plan'), 'check_stock')
  assert.equal(normalizeStage('purchase'), 'check_stock')
  assert.equal(normalizeStage('produce'), 'make')
  assert.equal(normalizeStage('store_finished'), 'store')
  assert.equal(normalizeStage('analyze'), 'done')
  assert.equal(normalizeStage('payment'), 'payment')
  assert.equal(normalizeStage('nonsense'), 'plan')
})

test('serialized pipelines never expose legacy stages or the lock', () => {
  const out = serializePipeline({ currentStage: 'sell', completedStages: ['plan', 'receive_plan', 'purchase', 'analyze'], lockedAt: new Date() })
  assert.equal(out.currentStage, 'done')
  assert.deepEqual(out.completedStages, ['plan', 'check_stock'])
  assert.equal('lockedAt' in out, false)
})

test('plan totals are recomputed on the server', () => {
  const plan = planFields({ productName: ' Latte ', targetQuantity: 100, ingredients: [{ id: 'a', name: 'Milk', quantity: 0.2, unit: 'litre', unitCost: 800 }, { name: '' }] })
  assert.equal(plan.productName, 'Latte')
  assert.equal(plan.ingredients.length, 1)
  assert.equal(plan.totalIngredients[0].totalQuantity, 20)
  assert.equal(plan.totalMaterialCost, 16000)
})

test('materials match whole words and only when unambiguous', () => {
  const stock = [{ item: 'Paper cup' }, { item: 'Fresh milk' }, { item: 'Milk Chocolate' }, { item: 'Coffee beans' }]
  assert.equal(matchByName(stock, 'Cup lid'), undefined)
  assert.equal(matchByName(stock, 'Coffee bean')?.item, 'Coffee beans')
  assert.equal(matchByName(stock, 'Paper cups')?.item, 'Paper cup')
  assert.equal(matchByName(stock, 'Milk'), undefined)
  assert.equal(matchByName(stock, 'fresh milk')?.item, 'Fresh milk')
})

test('finished products are told apart from materials', () => {
  assert.equal(isFinishedProduct({ itemType: 'finished_product' }), true)
  assert.equal(isFinishedProduct({ category: 'Finished Goods' }), true)
  assert.equal(isFinishedProduct({ itemType: 'raw_material', category: 'Dairy' }), false)
})

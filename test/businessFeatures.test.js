const assert = require('node:assert/strict')
const test = require('node:test')
const { businessFeatures } = require('../src/utils/businessFeatures')
const { BUSINESS_TEMPLATES } = require('../src/services/businessService')

test('processing templates enable manufacturing features', () => {
  for (const template of ['cafe', 'bakery', 'restaurant', 'maize_mill', 'juice_producer', 'furniture_workshop', 'soap_manufacturer', 'cosmetics', 'agro_processor']) {
    assert.equal(businessFeatures(template).processing, true, `${template} should enable processing`)
  }
})

test('retail, electronics, and unspecified templates do not enable processing', () => {
  for (const template of ['retail_shop', 'electronics_store', 'other', '', undefined]) {
    assert.equal(businessFeatures(template).processing, false, `${template || 'empty'} should not enable processing`)
  }
})

test('an explicit business setting overrides the template default', () => {
  assert.equal(businessFeatures('retail_shop', true).processing, true)
  assert.equal(businessFeatures('bakery', false).processing, false)
})

test('retail and electronics templates are available in business setup', () => {
  assert.ok(BUSINESS_TEMPLATES.includes('retail_shop'))
  assert.ok(BUSINESS_TEMPLATES.includes('electronics_store'))
})

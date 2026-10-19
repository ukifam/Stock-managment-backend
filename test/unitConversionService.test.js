const assert = require('node:assert/strict')
const test = require('node:test')

const { findConnectedPath, findConversionPath, normalizeUnitCode } = require('../src/services/unitConversionService')

const rules = [
  { productSku: '', fromUnit: 'kilogram', toUnit: 'gram', factor: 1000 },
  { productSku: '', fromUnit: 'gram', toUnit: 'spoon', factor: 0.08 },
]

test('unit conversion paths handle chained and reverse decimal conversions', () => {
  const toSpoons = findConversionPath(rules, 'kilogram', 'spoon')
  assert.equal(toSpoons.factor, 80)
  assert.deepEqual(toSpoons.units, ['kilogram', 'gram', 'spoon'])

  const toKilograms = findConversionPath(rules, 'spoon', 'kilogram')
  assert.equal(toKilograms.factor, 0.0125)
})

test('conversion graph detects a circular rule before it is saved', () => {
  assert.equal(findConnectedPath(rules, 'kilogram', 'spoon'), true)
  assert.equal(findConnectedPath(rules, 'litre', 'spoon'), false)
})

test('unit codes normalize predictably for matching and storage', () => {
  assert.equal(normalizeUnitCode('Millilitre'), 'millilitre')
  assert.equal(normalizeUnitCode('Retail Box'), 'retail_box')
})

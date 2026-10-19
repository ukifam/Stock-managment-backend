const assert = require('node:assert/strict')
const test = require('node:test')

const { evaluateQualityResults, normalizeQualityCriteria, normalizeQualityOutcome } = require('../src/utils/qualityEvaluation')

test('quality criteria require a measurable limit or required result', () => {
  assert.throws(() => normalizeQualityCriteria([{ name: 'Appearance' }]), /at least one quality limit/)
  assert.deepEqual(normalizeQualityCriteria([
    { name: 'Weight', minimum: 10, maximum: 20, unit: 'g' },
    { name: 'Color', requiredResult: 'Amber' },
  ]), [
    { name: 'Weight', minimum: 10, maximum: 20, requiredResult: '', unit: 'g' },
    { name: 'Color', minimum: null, maximum: null, requiredResult: 'Amber', unit: '' },
  ])
})

test('quality evaluation passes only when every result satisfies its standard', () => {
  const criteria = normalizeQualityCriteria([
    { name: 'Weight', minimum: 10, maximum: 20 },
    { name: 'Color', requiredResult: 'Amber' },
  ])
  assert.equal(evaluateQualityResults(criteria, [
    { name: 'Weight', value: 15 },
    { name: 'Color', value: 'Amber' },
  ]).passed, true)
  assert.equal(evaluateQualityResults(criteria, [
    { name: 'Weight', value: 21 },
    { name: 'Color', value: 'Amber' },
  ]).passed, false)
  assert.throws(() => evaluateQualityResults(criteria, [{ name: 'Weight', value: 15 }]), /Missing result/)
})

test('quality outcomes accept all required dispositions and reject unknown values', () => {
  assert.equal(normalizeQualityOutcome('passed'), 'PASS')
  assert.equal(normalizeQualityOutcome('failed'), 'FAIL')
  assert.equal(normalizeQualityOutcome('On Hold'), 'ON_HOLD')
  assert.equal(normalizeQualityOutcome('rejected'), 'REJECT')
  assert.throws(() => normalizeQualityOutcome('unknown'), /Quality result must/)
})

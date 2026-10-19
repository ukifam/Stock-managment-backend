const httpError = require('./httpError')

function normalizeQualityCriteria(criteria) {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    throw httpError(400, 'At least one quality criterion is required')
  }

  const names = new Set()
  return criteria.map((entry) => {
    const name = String(entry?.name || '').trim()
    if (!name) throw httpError(400, 'Every quality criterion needs a name')
    const key = name.toLowerCase()
    if (names.has(key)) throw httpError(400, `Duplicate quality criterion: ${name}`)
    names.add(key)

    const minimum = optionalNumber(entry.minimum, 'minimum', name)
    const maximum = optionalNumber(entry.maximum, 'maximum', name)
    const requiredResult = String(entry.requiredResult ?? '').trim()
    if (minimum === null && maximum === null && !requiredResult) {
      throw httpError(400, `${name} must define at least one quality limit or required result`)
    }
    if (minimum !== null && maximum !== null && minimum > maximum) {
      throw httpError(400, `${name} minimum cannot exceed its maximum`)
    }
    return { name, minimum, maximum, requiredResult, unit: String(entry.unit || '').trim() }
  })
}

function evaluateQualityResults(criteria, results) {
  if (!Array.isArray(results)) throw httpError(400, 'Inspection results are required')
  const byName = new Map()
  for (const result of results) {
    const name = String(result?.name || '').trim()
    const key = name.toLowerCase()
    if (!name || byName.has(key)) throw httpError(400, 'Inspection results must have unique criterion names')
    byName.set(key, result)
  }

  const evaluated = criteria.map((criterion) => {
    const result = byName.get(criterion.name.toLowerCase())
    if (!result || result.value === undefined || result.value === null || String(result.value).trim() === '') {
      throw httpError(400, `Missing result for quality criterion: ${criterion.name}`)
    }

    let passed = true
    let value = result.value
    if (criterion.minimum !== null || criterion.maximum !== null) {
      value = Number(value)
      if (!Number.isFinite(value)) throw httpError(400, `${criterion.name} result must be numeric`)
      if (criterion.minimum !== null && value < criterion.minimum) passed = false
      if (criterion.maximum !== null && value > criterion.maximum) passed = false
    }
    if (criterion.requiredResult && String(value).trim().toLowerCase() !== criterion.requiredResult.toLowerCase()) {
      passed = false
    }
    return { name: criterion.name, value, unit: criterion.unit, passed }
  })

  if (byName.size !== criteria.length) throw httpError(400, 'Inspection contains results not defined by its quality standard')
  return { passed: evaluated.every((result) => result.passed), results: evaluated }
}

function normalizeQualityOutcome(value) {
  const result = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  const normalized = ({ PASSED: 'PASS', FAILED: 'FAIL', REJECTED: 'REJECT' })[result] || result
  if (!['PASS', 'FAIL', 'ON_HOLD', 'REWORK', 'REJECT'].includes(normalized)) {
    throw httpError(400, 'Quality result must be PASS, FAIL, ON_HOLD, REWORK, or REJECT')
  }
  return normalized
}

function optionalNumber(value, label, name) {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) throw httpError(400, `${name} ${label} must be a valid number`)
  return number
}

module.exports = { evaluateQualityResults, normalizeQualityCriteria, normalizeQualityOutcome }

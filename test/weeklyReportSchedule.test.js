const test = require('node:test')
const assert = require('node:assert/strict')
const { latestDueRun, nextFridayRun, reportingPeriod } = require('../src/services/weeklyReportScheduler')

// 2026-11-06 is a Friday; 16:00 in Kigali is 14:00 UTC.
test('next run is this Friday at 16:00 Kigali until it passes', () => {
  assert.equal(nextFridayRun(new Date('2026-11-02T08:00:00Z')).toISOString(), '2026-11-06T14:00:00.000Z')
  assert.equal(nextFridayRun(new Date('2026-11-06T13:59:00Z')).toISOString(), '2026-11-06T14:00:00.000Z')
  assert.equal(nextFridayRun(new Date('2026-11-06T14:00:00Z')).toISOString(), '2026-11-13T14:00:00.000Z')
})

test('a server that wakes after Friday 16:00 still finds that week due', () => {
  assert.equal(latestDueRun(new Date('2026-11-06T14:05:00Z')).toISOString(), '2026-11-06T14:00:00.000Z')
  assert.equal(latestDueRun(new Date('2026-11-06T22:30:00Z')).toISOString(), '2026-11-06T14:00:00.000Z')
  assert.equal(latestDueRun(new Date('2026-11-09T07:00:00Z')).toISOString(), '2026-11-06T14:00:00.000Z')
})

test('the report covers Saturday to Friday', () => {
  assert.deepEqual(reportingPeriod(new Date('2026-11-06T14:00:00Z')), { from: '2026-10-31', to: '2026-11-06' })
})

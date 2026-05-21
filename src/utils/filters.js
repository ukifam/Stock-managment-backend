function filterByPeriod(rows, period = 'yearly') {
  return rows.filter((row) => isInPeriod(row.date, period))
}

function searchRows(rows, query) {
  if (!query) return rows
  const needle = query.toLowerCase()
  return rows.filter((row) => Object.values(row).some((value) => String(value).toLowerCase().includes(needle)))
}

function isInPeriod(value, period) {
  const date = new Date(`${value}T12:00:00`)
  const now = new Date()

  if (period === 'daily') return sameDay(date, now)
  if (period === 'weekly') return daysBetween(date, now) >= 0 && daysBetween(date, now) < 7
  if (period === 'monthly') return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
  if (period === 'quarterly') return date.getFullYear() === now.getFullYear() && quarter(date) === quarter(now)
  return date.getFullYear() === now.getFullYear()
}

function sameDay(left, right) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()
}

function quarter(date) {
  return Math.floor(date.getMonth() / 3)
}

function daysBetween(left, right) {
  const start = new Date(left.getFullYear(), left.getMonth(), left.getDate())
  const end = new Date(right.getFullYear(), right.getMonth(), right.getDate())
  return Math.floor((end.getTime() - start.getTime()) / 86400000)
}

module.exports = {
  filterByPeriod,
  searchRows,
}

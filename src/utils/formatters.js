function formatCurrency(value, currency = 'RWF') {
  const amount = Number(value || 0)
  const digits = currency === 'RWF' ? 0 : 2
  const formatted = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(amount)

  if (currency === 'RWF') {
    return `RWF ${formatted}`
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(amount)
}

function inventoryDto(row, currency) {
  return {
    ...row,
    rawStock: Number(row.stock || 0),
    rawCapacity: Number(row.capacity || 0),
    rawPrice: Number(row.price || 0),
    stock: `${row.stock} / ${row.capacity}`,
    price: formatCurrency(row.price, currency),
  }
}

function purchaseDto(row, currency) {
  const total = Number(row.quantity || 0) * Number(row.unitPrice || 0)
  const paidAmount = Number(row.paidAmount ?? (String(row.payment || '').toLowerCase() === 'credit' ? 0 : total))
  const outstanding = Number(row.outstanding ?? Math.max(0, total - paidAmount))
  return {
    ...row,
    rawQuantity: Number(row.quantity || 0),
    rawUnitPrice: Number(row.unitPrice || 0),
    rawValue: total,
    rawPaidAmount: paidAmount,
    rawOutstanding: outstanding,
    quantity: `${row.quantity} Units`,
    unitPrice: formatCurrency(row.unitPrice, currency),
    value: formatCurrency(total, currency),
    payment: row.payment || 'Cash',
    paidAmount: formatCurrency(paidAmount, currency),
    outstanding: formatCurrency(outstanding, currency),
  }
}

function saleDto(row, currency) {
  const total = Number(row.value || 0)
  const paidAmount = Number(row.paidAmount ?? (String(row.payment || '').toLowerCase() === 'credit' ? 0 : total))
  const outstanding = Number(row.outstanding ?? Math.max(0, total - paidAmount))
  return {
    ...row,
    rawQuantity: Number(row.quantity || 0),
    rawValue: total,
    rawPaidAmount: paidAmount,
    rawOutstanding: outstanding,
    items: `${row.quantity} Units`,
    value: formatCurrency(row.value, currency),
    payment: row.payment || 'Cash',
    paidAmount: formatCurrency(paidAmount, currency),
    outstanding: formatCurrency(outstanding, currency),
  }
}

function expenseDto(row, currency) {
  return {
    ...row,
    rawAmount: Number(row.amount || 0),
    item: row.description || row.vendor || 'Expense',
    category: row.category || 'Expense',
    value: formatCurrency(row.amount, currency),
    status: row.status || 'Recorded',
  }
}

module.exports = {
  formatCurrency,
  inventoryDto,
  purchaseDto,
  saleDto,
  expenseDto,
}

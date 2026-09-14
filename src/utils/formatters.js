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
  const rawItems = Array.isArray(row.items) && row.items.length > 0
    ? row.items
    : [
        {
          sku: row.sku || '',
          item: row.item || 'General Purchase',
          category: row.category || 'General',
          quantity: Number(row.quantity || 1),
          unitPrice: Number(row.unitPrice || row.value || 0),
          total: Number(row.value || (Number(row.quantity || 1) * Number(row.unitPrice || 0))),
        },
      ]

  const totalQuantity = rawItems.reduce((sum, it) => sum + Number(it.quantity || 0), 0)
  const computedSubtotal = rawItems.reduce((sum, it) => sum + Number(it.total || (it.quantity * it.unitPrice) || 0), 0)
  const subtotal = Number(row.subtotal != null ? row.subtotal : computedSubtotal)
  const discount = Number(row.discount || 0)
  const tax = Number(row.tax || 0)
  const total = Number(row.value != null ? row.value : (subtotal - discount + tax))
  const paidAmount = Number(row.paidAmount ?? (String(row.payment || '').toLowerCase() === 'credit' ? 0 : total))
  const outstanding = Number(row.outstanding ?? Math.max(0, total - paidAmount))

  const lineItems = rawItems.map((it) => ({
    ...it,
    quantity: Number(it.quantity || 1),
    unitPrice: Number(it.unitPrice || 0),
    total: Number(it.total || (it.quantity * it.unitPrice) || 0),
    formattedUnitPrice: formatCurrency(it.unitPrice || 0, currency),
    formattedTotal: formatCurrency(it.total || (it.quantity * it.unitPrice) || 0, currency),
  }))

  const itemSummary = lineItems.map((it) => `${it.item} × ${it.quantity}`).join(', ')

  return {
    ...row,
    lineItems,
    itemSummary,
    items: `${totalQuantity} Units`,
    item: row.item || (lineItems.length === 1 ? lineItems[0].item : `${lineItems.length} items`),
    rawQuantity: totalQuantity,
    rawUnitPrice: lineItems[0]?.unitPrice || 0,
    rawSubtotal: subtotal,
    rawDiscount: discount,
    rawTax: tax,
    rawValue: total,
    rawPaidAmount: paidAmount,
    rawOutstanding: outstanding,
    quantity: `${totalQuantity} Units`,
    unitPrice: formatCurrency(lineItems[0]?.unitPrice || 0, currency),
    subtotal: formatCurrency(subtotal, currency),
    discount: formatCurrency(discount, currency),
    tax: formatCurrency(tax, currency),
    value: formatCurrency(total, currency),
    payment: row.payment || 'Cash',
    paidAmount: formatCurrency(paidAmount, currency),
    outstanding: formatCurrency(outstanding, currency),
  }
}

function saleDto(row, currency) {
  const rawItems = Array.isArray(row.items) && row.items.length > 0
    ? row.items
    : [
        {
          sku: row.sku || '',
          item: row.item || 'General Sale',
          category: row.category || 'General',
          quantity: Number(row.quantity || 1),
          unitPrice: Number(row.quantity ? (Number(row.value || 0) / Number(row.quantity)) : Number(row.value || 0)),
          total: Number(row.value || 0),
        },
      ]

  const totalQuantity = rawItems.reduce((sum, it) => sum + Number(it.quantity || 0), 0)
  const computedSubtotal = rawItems.reduce((sum, it) => sum + Number(it.total || (it.quantity * it.unitPrice) || 0), 0)
  const subtotal = Number(row.subtotal != null ? row.subtotal : computedSubtotal)
  const discount = Number(row.discount || 0)
  const tax = Number(row.tax || 0)
  const total = Number(row.value != null ? row.value : (subtotal - discount + tax))
  const paidAmount = Number(row.paidAmount ?? (String(row.payment || '').toLowerCase() === 'credit' ? 0 : total))
  const outstanding = Number(row.outstanding ?? Math.max(0, total - paidAmount))

  const lineItems = rawItems.map((it) => ({
    ...it,
    quantity: Number(it.quantity || 1),
    unitPrice: Number(it.unitPrice || 0),
    total: Number(it.total || (it.quantity * it.unitPrice) || 0),
    formattedUnitPrice: formatCurrency(it.unitPrice || 0, currency),
    formattedTotal: formatCurrency(it.total || (it.quantity * it.unitPrice) || 0, currency),
  }))

  const itemSummary = lineItems.map((it) => `${it.item} × ${it.quantity}`).join(', ')

  return {
    ...row,
    lineItems,
    itemSummary,
    items: `${totalQuantity} Units`,
    item: row.item || (lineItems.length === 1 ? lineItems[0].item : `${lineItems.length} items`),
    rawQuantity: totalQuantity,
    rawSubtotal: subtotal,
    rawDiscount: discount,
    rawTax: tax,
    rawValue: total,
    rawPaidAmount: paidAmount,
    rawOutstanding: outstanding,
    quantity: `${totalQuantity} Units`,
    subtotal: formatCurrency(subtotal, currency),
    discount: formatCurrency(discount, currency),
    tax: formatCurrency(tax, currency),
    value: formatCurrency(total, currency),
    payment: row.payment || 'Cash',
    paidAmount: formatCurrency(paidAmount, currency),
    outstanding: formatCurrency(outstanding, currency),
  }
}

function expenseDto(row, currency) {
  const rawItems = Array.isArray(row.items) && row.items.length > 0
    ? row.items
    : [
        {
          description: row.description || row.vendor || 'Expense',
          category: row.category || 'General',
          amount: Number(row.amount || 0),
        },
      ]

  const totalAmount = rawItems.reduce((sum, it) => sum + Number(it.amount || 0), 0)
  const amount = Number(row.amount != null ? row.amount : totalAmount)

  const lineItems = rawItems.map((it) => ({
    ...it,
    amount: Number(it.amount || 0),
    formattedAmount: formatCurrency(it.amount || 0, currency),
  }))

  const itemSummary = lineItems.map((it) => it.description).join(', ')

  return {
    ...row,
    lineItems,
    itemSummary,
    rawAmount: amount,
    item: row.description || row.vendor || (lineItems.length === 1 ? lineItems[0].description : `${lineItems.length} items`),
    category: row.category || lineItems[0]?.category || 'Expense',
    value: formatCurrency(amount, currency),
    payment: row.payment || 'Cash',
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

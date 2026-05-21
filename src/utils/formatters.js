function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0))
}

function inventoryDto(row) {
  return {
    ...row,
    rawStock: Number(row.stock || 0),
    rawCapacity: Number(row.capacity || 0),
    rawPrice: Number(row.price || 0),
    stock: `${row.stock} / ${row.capacity}`,
    price: formatCurrency(row.price),
  }
}

function purchaseDto(row) {
  const total = Number(row.value ?? row.quantity * row.unitPrice)
  return {
    ...row,
    quantity: `${row.quantity} Units`,
    value: formatCurrency(total),
  }
}

function saleDto(row) {
  return {
    ...row,
    items: `${row.quantity} Units`,
    value: formatCurrency(row.value),
  }
}

module.exports = {
  formatCurrency,
  inventoryDto,
  purchaseDto,
  saleDto,
}

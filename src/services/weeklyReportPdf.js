function createWeeklyReportPdf({ from, to, sections }) {
  const lines = [
    'WEEKLY BUSINESS REPORT',
    `Reporting period: ${from} to ${to} (Africa/Kigali)`,
    `Prepared: ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Kigali' }).format(new Date())} CAT`,
    '',
  ]

  for (const section of sections) {
    lines.push(`BRANCH: ${section.name}`, '')
    for (const metric of section.report.metrics || []) lines.push(`${metric.label}: ${metric.value}`)
    const summary = section.report.summary || {}
    lines.push('', 'WEEKLY ACTIVITY',
      `Sales: ${summary.salesCount || 0} transactions | ${summary.totalSales || '0'}`,
      `Purchases: ${summary.purchasesCount || 0} | ${summary.totalPurchases || '0'}`,
      `Expenses: ${summary.expensesCount || 0} | ${summary.totalExpenses || '0'}`,
      `Net profit: ${summary.netProfit || '0'}`,
      `Low stock items: ${summary.lowStockCount || 0} | Out of stock: ${summary.outOfStockCount || 0}`,
      '', 'TOP PRODUCTS')
    const products = section.report.topProducts || []
    if (!products.length) lines.push('No sales recorded during this period.')
    else products.slice(0, 5).forEach((product, index) => lines.push(`${index + 1}. ${product.name || product.item || product.sku || 'Product'} - ${product.quantity || 0} units - ${product.value || product.total || ''}`))
    lines.push('', 'RECENT TRANSACTIONS')
    const transactions = section.report.recentTransactions || []
    if (!transactions.length) lines.push('No transactions recorded during this period.')
    else transactions.slice(0, 10).forEach((row) => lines.push(`${row.date || ''} | ${row.type || ''} | ${row.item || row.customer || row.supplier || row.description || ''} | ${row.value || ''}`))
    lines.push('', '')
  }

  const pages = []
  for (let index = 0; index < lines.length; index += 44) pages.push(lines.slice(index, index + 44))
  if (!pages.length) pages.push(['No report data available.'])
  return buildPdf(pages)
}

function buildPdf(pages) {
  const objects = []
  const addObject = (value) => { objects.push(value); return objects.length }
  const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const pageIds = []

  pages.forEach((lines) => {
    const commands = ['BT', '/F1 10 Tf', '48 790 Td', '14 TL']
    lines.forEach((line, index) => {
      if (index) commands.push('T*')
      if (index === 0) commands.push('/F1 16 Tf')
      else if (index === 1) commands.push('/F1 10 Tf')
      commands.push(`(${escapePdfText(line)}) Tj`)
    })
    commands.push('ET')
    const stream = Buffer.from(commands.join('\n'), 'latin1')
    const contentId = addObject(`<< /Length ${stream.length} >>\nstream\n${stream.toString('latin1')}\nendstream`)
    const pageId = addObject(`<< /Type /Page /Parent PAGES /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`)
    pageIds.push(pageId)
  })

  const pagesId = addObject(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`)
  pageIds.forEach((id) => { objects[id - 1] = objects[id - 1].replace('PAGES', `${pagesId} 0 R`) })
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)

  let document = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document, 'latin1'))
    document += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(document, 'latin1')
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.slice(1).forEach((offset) => { document += `${String(offset).padStart(10, '0')} 00000 n \n` })
  document += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(document, 'latin1')
}

function escapePdfText(value) {
  return String(value ?? '').normalize('NFKD').replace(/[^\x20-\x7E]/g, '?').replace(/[\\()]/g, '\\$&').slice(0, 150)
}

module.exports = { createWeeklyReportPdf }

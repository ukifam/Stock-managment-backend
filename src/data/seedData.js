const seedData = {
  inventory: [
    { date: '2026-05-19', item: 'Samsung Neo QLED 8K', meta: 'High Resolution Series', sku: 'SAM-8K-900B', category: 'Visual Displays', stock: 12, capacity: 25, price: 4299, status: 'Active', serial: '7902-X-22', supplier: 'Samsung Global', shelfLocation: 'Z-14 / Bay 04', leadTime: '14 Days', warranty: 'Active (24m)' },
    { date: '2026-05-19', item: 'Sony Alpha A7 IV', meta: 'Full-frame Mirrorless', sku: 'SNY-A74-BODY', category: 'Imaging Gear', stock: 3, capacity: 20, price: 2498, status: 'Low', serial: 'A74-0922-BD', supplier: 'Sony Imaging', shelfLocation: 'I-07 / Bay 02', leadTime: '10 Days', warranty: 'Active (18m)' },
    { date: '2026-05-04', item: 'Apple MacBook Pro 16"', meta: 'M3 Max 64GB RAM', sku: 'APL-MBP-M3MX', category: 'Computing', stock: 24, capacity: 30, price: 3699, status: 'Active', serial: 'MBP16-M3-64', supplier: 'Apple Enterprise', shelfLocation: 'C-11 / Bay 01', leadTime: '7 Days', warranty: 'Active (12m)' },
    { date: '2026-04-18', item: 'Logitech MX Master 3S', meta: 'Performance Mouse', sku: 'LOG-MXM3S-GR', category: 'Peripherals', stock: 95, capacity: 100, price: 99, status: 'Active', serial: 'MX3S-GR-BULK', supplier: 'Logitech Supply', shelfLocation: 'P-03 / Bay 09', leadTime: '5 Days', warranty: 'Active (24m)' },
    { date: '2026-01-12', item: 'DJI Mavic 3 Pro', meta: 'Professional Camera Drone', sku: 'DJI-M3P-FLY', category: 'Drones', stock: 6, capacity: 20, price: 2199, status: 'Low', serial: 'M3P-FLY-2026', supplier: 'DJI Global', shelfLocation: 'D-02 / Bay 06', leadTime: '21 Days', warranty: 'Active (12m)' },
    { date: '2026-05-10', item: 'Graphene Battery Pack', meta: 'High-density mobile power', sku: 'GB-990-CELL', category: 'Power', stock: 0, capacity: 40, price: 249, status: 'Out of Stock', serial: 'GB990-CELL', supplier: 'Graphene Works', shelfLocation: 'B-08 / Bay 03', leadTime: '18 Days', warranty: 'Expired' },
  ],
  purchases: [
    { date: '2026-05-19', id: 'PO-9281-A', supplier: 'Zenith-Core Systems', phone: '+1 (555) 341-9012', item: 'ProBook Elite X1 Series', quantity: 14, unitPrice: 1249, status: 'Receiving' },
    { date: '2026-05-11', id: 'PO-9278-C', supplier: 'Samsung Global', phone: '+1 (555) 884-1209', item: 'Neo QLED 8K Display', quantity: 10, unitPrice: 4299, status: 'Confirmed' },
    { date: '2026-04-26', id: 'PO-9273-Q', supplier: 'Vector Input Labs', phone: '+1 (555) 229-0144', item: 'Mechanical Deck Batch', quantity: 60, unitPrice: 189, status: 'Pending' },
    { date: '2026-02-09', id: 'PO-9269-B', supplier: 'Sonic Core Audio', phone: '+1 (555) 671-8931', item: 'ANC Obsidian Headsets', quantity: 32, unitPrice: 349, status: 'Delayed' },
  ],
  sales: [
    { date: '2026-05-19', id: 'SO-90210-A', customer: 'Alexander Sterling', phone: '+1 (555) 892-4410', item: 'Neural Pad Pro X1', quantity: 4, value: 2371.81, payment: 'Credit', status: 'Active Cart' },
    { date: '2026-05-08', id: 'SO-90204-C', customer: 'Northstar Retail', phone: '+1 (555) 408-7712', item: 'Neo QLED 8K Display', quantity: 18, value: 18290, payment: 'Wire', status: 'Processing' },
    { date: '2026-04-03', id: 'SO-90198-L', customer: 'Helio Systems', phone: '+1 (555) 732-1830', item: 'DJI Mavic 3 Pro', quantity: 6, value: 7840, payment: 'Credit', status: 'Completed' },
    { date: '2026-03-20', id: 'SO-90182-M', customer: 'Vertex Labs', phone: '+1 (555) 510-9928', item: 'Sony Alpha A7 IV', quantity: 2, value: 4998, payment: 'Crypto', status: 'Draft' },
  ],
  settings: {
    profile: { displayName: 'System Operator 01', email: 'operator@quantum-ai.nexus' },
    system: { darkMode: true, biometricLogin: false, telemetryReports: true, quantumSync: true },
    inventory: { lowStockThreshold: 25, autoBackupFrequency: 'Daily at 00:00', externalDatabase: 'node-72.nexus.cloud' },
    hardware: [
      { name: 'Handheld Scanner #02', status: 'online' },
      { name: 'Thermal Label Printer', status: 'online' },
      { name: 'Precision Scale v4', status: 'attention' },
    ],
  },
}

module.exports = seedData

const seedData = {
  inventory: [
    { date: '2026-05-19', item: 'Hikvision 4MP Bullet Camera', meta: 'Outdoor CCTV', sku: 'HIK-4MP-BULL', category: 'Security Cameras', stock: 12, capacity: 50, price: 45000, status: 'Active', serial: '7902-X-22', supplier: 'Security World', shelfLocation: 'Z-14 / Bay 04', leadTime: '14 Days', warranty: 'Active (24m)' },
    { date: '2026-05-19', item: 'Dahua 8-Channel NVR', meta: 'Network Video Recorder', sku: 'DAH-8CH-NVR', category: 'Recording Devices', stock: 3, capacity: 20, price: 125000, status: 'Low', serial: 'A74-0922-BD', supplier: 'Security World', shelfLocation: 'I-07 / Bay 02', leadTime: '10 Days', warranty: 'Active (18m)' },
    { date: '2026-05-04', item: 'Cat6 Ethernet Cable (305m)', meta: 'Networking Cable', sku: 'CAB-CAT6-305', category: 'Cables & Accessories', stock: 24, capacity: 50, price: 85000, status: 'Active', serial: 'CAB16-305', supplier: 'Tech Supply Kigali', shelfLocation: 'C-11 / Bay 01', leadTime: '7 Days', warranty: 'N/A' },
    { date: '2026-04-18', item: 'Seagate SkyHawk 4TB HDD', meta: 'Surveillance Hard Drive', sku: 'SEA-4TB-SURV', category: 'Storage', stock: 15, capacity: 30, price: 110000, status: 'Active', serial: 'SEA-4TB-BULK', supplier: 'Tech Supply Kigali', shelfLocation: 'P-03 / Bay 09', leadTime: '5 Days', warranty: 'Active (24m)' },
    { date: '2026-01-12', item: '12V 5A Power Supply', meta: 'CCTV Power Adapter', sku: 'PWR-12V-5A', category: 'Power', stock: 6, capacity: 40, price: 15000, status: 'Low', serial: 'PWR-5A-2026', supplier: 'Electra RW', shelfLocation: 'D-02 / Bay 06', leadTime: '21 Days', warranty: 'Active (12m)' },
    { date: '2026-05-10', item: 'ZKTeco Biometric Reader', meta: 'Access Control', sku: 'ZKT-BIO-F22', category: 'Access Control', stock: 0, capacity: 20, price: 250000, status: 'Out of Stock', serial: 'ZKT-F22-CELL', supplier: 'Security World', shelfLocation: 'B-08 / Bay 03', leadTime: '18 Days', warranty: 'Expired' },
  ],
  purchases: [
    { date: '2026-05-19', id: 'PO-9281-A', supplier: 'Security World', phone: '+250-788-000-111', item: 'Hikvision 4MP Bullet Camera', quantity: 14, unitPrice: 40000, status: 'Receiving' },
    { date: '2026-05-11', id: 'PO-9278-C', supplier: 'Tech Supply Kigali', phone: '+250-788-000-222', item: 'Seagate SkyHawk 4TB HDD', quantity: 10, unitPrice: 100000, status: 'Confirmed' },
    { date: '2026-04-26', id: 'PO-9273-Q', supplier: 'Electra RW', phone: '+250-788-000-333', item: '12V 5A Power Supply', quantity: 60, unitPrice: 12000, status: 'Pending' },
    { date: '2026-02-09', id: 'PO-9269-B', supplier: 'Security World', phone: '+250-788-000-111', item: 'Dahua 8-Channel NVR', quantity: 5, unitPrice: 110000, status: 'Delayed' },
  ],
  sales: [
    { date: '2026-05-19', id: 'SO-90210-A', customer: 'Bank of Kigali', phone: '+250-781-111-222', item: 'Hikvision 4MP Bullet Camera', quantity: 4, value: 180000, payment: 'Credit', status: 'Active Cart' },
    { date: '2026-05-08', id: 'SO-90204-C', customer: 'Kigali Heights', phone: '+250-782-222-333', item: 'Dahua 8-Channel NVR', quantity: 2, value: 250000, payment: 'Wire', status: 'Processing' },
    { date: '2026-04-03', id: 'SO-90198-L', customer: 'Inyange Industries', phone: '+250-783-333-444', item: 'Cat6 Ethernet Cable (305m)', quantity: 3, value: 255000, payment: 'Credit', status: 'Completed' },
    { date: '2026-03-20', id: 'SO-90182-M', customer: 'MTN Rwanda', phone: '+250-784-444-555', item: 'ZKTeco Biometric Reader', quantity: 1, value: 250000, payment: 'Cash', status: 'Draft' },
  ],
  stockMovements: [
    { date: '2026-05-19', sku: 'HIK-4MP-BULL', type: 'OPENING_STOCK', quantity: 12, previousStock: 0, newStock: 12, reason: 'Initial import', reference: 'SYS-INIT', user: 'System' },
    { date: '2026-05-19', sku: 'DAH-8CH-NVR', type: 'OPENING_STOCK', quantity: 3, previousStock: 0, newStock: 3, reason: 'Initial import', reference: 'SYS-INIT', user: 'System' },
    { date: '2026-05-04', sku: 'CAB-CAT6-305', type: 'OPENING_STOCK', quantity: 24, previousStock: 0, newStock: 24, reason: 'Initial import', reference: 'SYS-INIT', user: 'System' },
    { date: '2026-04-18', sku: 'SEA-4TB-SURV', type: 'OPENING_STOCK', quantity: 15, previousStock: 0, newStock: 15, reason: 'Initial import', reference: 'SYS-INIT', user: 'System' },
    { date: '2026-01-12', sku: 'PWR-12V-5A', type: 'OPENING_STOCK', quantity: 6, previousStock: 0, newStock: 6, reason: 'Initial import', reference: 'SYS-INIT', user: 'System' },
    { date: '2026-05-10', sku: 'ZKT-BIO-F22', type: 'OPENING_STOCK', quantity: 0, previousStock: 0, newStock: 0, reason: 'Initial import', reference: 'SYS-INIT', user: 'System' },
  ],
  settings: {
    profile: { displayName: 'System Operator 01', email: 'operator@tri.ltd' },
    system: { darkMode: true, biometricLogin: false, telemetryReports: true, quantumSync: true },
    inventory: { lowStockThreshold: 25, autoBackupFrequency: 'Daily at 00:00', externalDatabase: 'node-72.nexus.cloud' },
    financial: { currency: 'RWF' },
    hardware: [
      { name: 'Handheld Scanner #02', status: 'online' },
      { name: 'Thermal Label Printer', status: 'online' },
      { name: 'Precision Scale v4', status: 'attention' },
    ],
  },
  venues: [
    { name: 'Central Warehouse', code: 'WH-001', type: 'Warehouse', location: 'Kigali', address: '123 Industrial Park Road, Kigali, Rwanda', capacity: 5000, manager: 'James Muiruri', contact: '+250-787-654-321', status: 'Active', notes: 'Main distribution center for East Africa' },
    { name: 'Downtown Retail Store', code: 'RT-001', type: 'Retail', location: 'Kigali City Center', address: '456 Business District, Kigali', capacity: 500, manager: 'Sarah Johnson', contact: '+250-788-123-456', status: 'Active', notes: 'Primary retail outlet' },
    { name: 'Regional Distribution Hub', code: 'DH-001', type: 'Distribution', location: 'Huye', address: '789 Commerce Avenue, Huye, Rwanda', capacity: 3000, manager: 'David Okonkwo', contact: '+250-789-876-543', status: 'Active', notes: 'Regional distribution center' },
    { name: 'Kampala Branch', code: 'BR-001', type: 'Warehouse', location: 'Kampala, Uganda', address: '321 Export Zone, Kampala', capacity: 2000, manager: 'Amara Okafor', contact: '+256-703-456-789', status: 'Active', notes: 'Uganda operations hub' },
    { name: 'Nairobi Storage', code: 'ST-001', type: 'Warehouse', location: 'Nairobi, Kenya', address: '654 Industrial Estate, Nairobi', capacity: 2500, manager: 'Priya Sharma', contact: '+254-722-123-456', status: 'Inactive', notes: 'Seasonal storage facility' },
  ],
}

module.exports = seedData

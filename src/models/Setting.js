const mongoose = require('mongoose')

const settingSchema = new mongoose.Schema(
  {
    profile: {
      displayName: { type: String, default: 'System Operator 01' },
      email: { type: String, default: 'operator@quantum-ai.nexus' },
    },
    system: {
      darkMode: { type: Boolean, default: true },
      biometricLogin: { type: Boolean, default: false },
      telemetryReports: { type: Boolean, default: true },
      quantumSync: { type: Boolean, default: true },
    },
    inventory: {
      lowStockThreshold: { type: Number, default: 25 },
      autoBackupFrequency: { type: String, default: 'Daily at 00:00' },
      externalDatabase: { type: String, default: 'node-72.nexus.cloud' },
    },
    hardware: [
      {
        name: { type: String, required: true },
        status: { type: String, default: 'online' },
      },
    ],
  },
  { timestamps: true }
)

module.exports = mongoose.model('Setting', settingSchema)

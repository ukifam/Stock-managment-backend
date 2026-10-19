const mongoose = require('mongoose')

const notificationSchema = new mongoose.Schema(
  {
    ownerKey: { type: String, required: true, index: true },
    recipientEmail: { type: String, default: '', lowercase: true, trim: true, index: true },
    actorId: { type: String, default: '' },
    actorUsername: { type: String, default: 'System' },
    actorRole: { type: String, default: '' },
    title: { type: String, required: true },
    message: { type: String, required: true },
    category: {
      type: String,
      enum: ['production', 'inventory', 'sales', 'loans', 'transfers', 'users', 'system'],
      default: 'production',
      index: true,
    },
    severity: {
      type: String,
      enum: ['critical', 'warning', 'info', 'success'],
      default: 'info',
    },
    targetPage: { type: String, default: 'pipeline' },
    actionLabel: { type: String, default: 'View Pipeline' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    read: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
)

module.exports = mongoose.model('Notification', notificationSchema)

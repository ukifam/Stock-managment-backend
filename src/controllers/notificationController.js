const Notification = require('../models/Notification')
const User = require('../models/User')
const Business = require('../models/Business')
const { sendProductionActivityEmail } = require('../services/notificationMailer')

async function listNotifications(req, res, next) {
  try {
    const ownerKey = req.user.ownerKey
    const limit = Math.min(Number(req.query.limit || 50), 100)
    const filter = { ownerKey }
    if (req.query.unread === 'true') {
      filter.read = false
    }

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()

    const unreadCount = await Notification.countDocuments({ ownerKey, read: false })

    res.json({
      notifications,
      unreadCount,
    })
  } catch (error) {
    next(error)
  }
}

async function markAsRead(req, res, next) {
  try {
    const { id } = req.params
    const notification = await Notification.findOneAndUpdate(
      { _id: id, ownerKey: req.user.ownerKey },
      { read: true },
      { new: true }
    )
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' })
    }
    res.json(notification)
  } catch (error) {
    next(error)
  }
}

async function markAllAsRead(req, res, next) {
  try {
    await Notification.updateMany({ ownerKey: req.user.ownerKey, read: false }, { read: true })
    res.json({ success: true, message: 'All notifications marked as read' })
  } catch (error) {
    next(error)
  }
}

async function recordPipelineActivity(req, res, next) {
  try {
    const {
      pipelineId,
      stage,
      stageLabel = stage,
      productName,
      summary,
      details,
      metrics = {},
      severity = 'info',
    } = req.body

    const currentUser = req.user
    const ownerKey = currentUser.ownerKey

    // 1. Locate the Shop Admin / Owner email
    let adminEmail = currentUser.ownerEmail || ''
    if (!adminEmail) {
      const adminAccount = await User.findOne({ ownerKey, role: 'admin', active: { $ne: false } })
        .select('email')
        .lean()
      if (adminAccount) adminEmail = adminAccount.email
    }
    if (!adminEmail) {
      const biz = await Business.findOne({ ownerKey }).select('ownerEmail email').lean()
      adminEmail = biz?.ownerEmail || biz?.email || ''
    }

    const workerName = currentUser.username || 'Staff Worker'
    const workerRole = currentUser.shopRole || currentUser.role || 'operator'

    const title = `${stageLabel}: ${productName || pipelineId}`
    const message = summary || `${workerName} (${workerRole}) executed stage "${stageLabel}" on batch ${productName || pipelineId}.`

    // 2. Save Notification in MongoDB
    const notification = await Notification.create({
      ownerKey,
      recipientEmail: adminEmail,
      actorId: currentUser.id,
      actorUsername: workerName,
      actorRole: workerRole,
      title,
      message,
      category: 'production',
      severity,
      targetPage: 'pipeline',
      actionLabel: 'View Pipeline',
      metadata: {
        pipelineId,
        stage,
        stageLabel,
        productName,
        metrics,
        details,
      },
      read: false,
    })

    // 3. Dispatch Email Alert to Admin (runs in background so response isn't blocked)
    if (adminEmail) {
      sendProductionActivityEmail({
        adminEmail,
        workerName,
        workerRole,
        stageLabel,
        productName: productName || 'Production Item',
        pipelineId,
        details: details || summary || '',
        metrics,
      }).catch((emailErr) => {
        console.error('[NOTIFICATION EMAIL ERROR]', emailErr.message)
      })
    }

    res.status(201).json({
      success: true,
      notification,
    })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  listNotifications,
  markAsRead,
  markAllAsRead,
  recordPipelineActivity,
}

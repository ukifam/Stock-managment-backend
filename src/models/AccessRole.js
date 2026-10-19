const mongoose = require('mongoose')

const permissionSchema = new mongoose.Schema(
  {
    module: { type: String, required: true, trim: true },
    actions: { type: [String], default: [] },
  },
  { _id: false }
)

const accessRoleSchema = new mongoose.Schema(
  {
    ownerKey: { type: String, required: true, trim: true, index: true },
    ownerEmail: { type: String, default: '', lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, default: '' },
    permissions: { type: [permissionSchema], default: [] },
    builtIn: { type: Boolean, default: false },
    active: { type: Boolean, default: true, index: true },
    createdBy: { id: String, username: String, email: String },
  },
  { timestamps: true }
)

accessRoleSchema.index({ ownerKey: 1, code: 1 }, { unique: true })

module.exports = mongoose.model('AccessRole', accessRoleSchema)

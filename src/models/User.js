const mongoose = require('mongoose')
const { SHOP_ROLES } = require('../utils/shopRoles')

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['system_admin', 'admin', 'staff'], default: 'admin', index: true },
    shopRole: { type: String, enum: SHOP_ROLES, default: 'sales_associate', index: true },
    ownerKey: { type: String, default: '', index: true },
    ownerEmail: { type: String, default: '', lowercase: true, trim: true },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
)

module.exports = mongoose.model('User', userSchema)

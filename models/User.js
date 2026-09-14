const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    // Required unless role is super_admin
    required: function () { return this.role !== 'super_admin'; }
  },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ['super_admin', 'admin', 'staff', 'kitchen'],
    default: 'staff'
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended'],
    default: 'active'
  },
  permissions: [{ type: String }], // Optional granular permissions
  profileImage: { type: String }, // Admin profile picture
  lastLogin: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

// Compound index for role filtering within tenant
userSchema.index({ tenantId: 1, role: 1 });

module.exports = mongoose.model('User', userSchema);
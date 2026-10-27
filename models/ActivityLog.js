const mongoose = require('mongoose');

const ActivityLogSchema = new mongoose.Schema({
  eventType: {
    type: String,
    required: true,
    enum: [
      'PAGE_VIEW',
      'INTERACTION',
      'LEAD_SUBMISSION',
      'ORDER_PLACED',
      'USER_LOGIN',
      'PLAN_CHANGE',
      'TICKET_CREATED',
      'STAFF_ACTION',
      'MENU_VIEW'
    ],
    index: true
  },
  action: {
    type: String,
    required: true
  },
  category: {
    type: String,
    default: 'Traffic',
    enum: ['Traffic', 'Lead', 'Orders', 'Auth', 'Operations', 'Support'],
    index: true
  },
  path: {
    type: String,
    default: '/'
  },
  user: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, default: 'Guest Visitor' },
    email: { type: String, default: 'visitor@guest.net' },
    role: { type: String, default: 'guest' },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
    tenantName: { type: String, default: 'Public Web' }
  },
  ip: {
    type: String,
    default: '127.0.0.1'
  },
  city: {
    type: String,
    default: 'Bangalore'
  },
  country: {
    type: String,
    default: 'India'
  },
  device: {
    type: String,
    default: 'Desktop' // 'Mobile', 'Desktop', 'Tablet'
  },
  browser: {
    type: String,
    default: 'Chrome'
  },
  referrer: {
    type: String,
    default: 'Direct'
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
}, { timestamps: true });

// Compound indexes for high-speed analytics queries
ActivityLogSchema.index({ timestamp: -1, eventType: 1 });
ActivityLogSchema.index({ category: 1, timestamp: -1 });

module.exports = mongoose.model('ActivityLog', ActivityLogSchema);

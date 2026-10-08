const mongoose = require('mongoose');

const ServiceRequestSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    index: true
  },
  tableNumber: {
    type: String,
    required: true,
    trim: true
  },
  customerName: {
    type: String,
    default: 'Guest Diner'
  },
  customerPhone: {
    type: String,
    default: ''
  },
  type: {
    type: String,
    enum: ['call_waiter', 'request_bill', 'water', 'custom'],
    default: 'call_waiter'
  },
  paymentMethod: {
    type: String,
    default: null
  },
  amount: {
    type: Number,
    default: 0
  },
  notes: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['pending', 'attending', 'resolved'],
    default: 'pending',
    index: true
  }
}, {
  timestamps: true
});

ServiceRequestSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('ServiceRequest', ServiceRequestSchema);

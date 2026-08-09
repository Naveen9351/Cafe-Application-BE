const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  email: { type: String, trim: true },
  loyaltyPoints: { type: Number, default: 0 },
  visitCount: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

customerSchema.index({ tenantId: 1, phone: 1 }, { unique: true });

module.exports = mongoose.model('Customer', customerSchema);

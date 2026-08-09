const mongoose = require('mongoose');

const OutletSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  address: {
    type: String,
    required: true
  },
  contactNumber: {
    type: String,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  settings: {
    currency: { type: String, default: 'INR' },
    taxRate: { type: Number, default: 5 }, // Percentage
    serviceChargeRate: { type: Number, default: 0 } // Percentage
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Outlet', OutletSchema);

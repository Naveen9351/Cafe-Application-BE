const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  invoiceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    sparse: true
  },
  // Table number is now tenant-specific string or ID
  tableNumber: { type: String, required: true },

  // Who took the order (optional, could be self-service via QR)
  waiterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  items: [
    {
      item: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true },
      quantity: { type: Number, required: true, min: 1 },
      price: { type: Number, required: true }, // Store price at time of order
      name: { type: String }, // Snapshot of name
      variant: {
        name: { type: String },
        price: { type: Number }
      },
      addons: [
        {
          name: { type: String },
          price: { type: Number }
        }
      ]
    }
  ],

  // Financials
  subTotal: { type: Number, required: true },
  taxAmount: { type: Number, default: 0 },
  total: { type: Number, required: true },

  status: {
    type: String,
    enum: ['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'],
    default: 'pending',
    index: true
  },

  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'partial', 'khata', 'failed', 'refunded'],
    default: 'pending'
  },

  orderType: {
    type: String,
    enum: ['dine_in', 'takeaway', 'online'],
    default: 'dine_in'
  },

  customerDetails: {
    name: { type: String },
    phone: { type: String }
  },

  // Split bill info
  isSplit: { type: Boolean, default: false },
  splits: [
    {
      customerName: { type: String },
      amount: { type: Number },
      paymentStatus: { type: String, enum: ['pending', 'paid'], default: 'pending' },
      paymentMethod: { type: String }
    }
  ],

  // Loyalty points
  loyaltyPointsEarned: { type: Number, default: 0 },
  loyaltyPointsRedeemed: { type: Number, default: 0 },

  // Estimated prep time
  estimatedTime: { type: Number }, // Minutes

  createdAt: { type: Date, default: Date.now }
});

// Index for efficient querying of a tenant's orders
orderSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
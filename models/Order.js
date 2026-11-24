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
  orderNumber: { type: String, index: true, trim: true },
  tableNumber: { type: String, required: true },
  originalTable: { type: String, trim: true },
  mergedInto: { type: String, trim: true },
  roundNumber: { type: Number, default: 1 },

  // Who took the order (optional, could be self-service via QR)
  waiterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  items: [
    {
      item: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: false },
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
      ],
      specialNotes: { type: String, default: '' },
      notes: { type: String, default: '' },
      itemStatus: {
        type: String,
        enum: ['pending', 'preparing', 'ready', 'served'],
        default: 'preparing'
      },
      isPaid: { type: Boolean, default: false },
      paidAt: { type: Date },
      itemPaymentMethod: { type: String },
      isDirect: { type: Boolean, default: false }
    }
  ],

  // Financials
  subTotal: { type: Number, required: true },
  taxAmount: { type: Number, default: 0 },
  total: { type: Number, required: true },
  totalAmount: { type: Number },
  discountAmount: { type: Number, default: 0 },
  discountReason: { type: String, default: '' },
  settledAmount: { type: Number },
  paidAmount: { type: Number, default: 0 },
  paymentMethod: { type: String, default: null },

  status: {
    type: String,
    enum: ['pending', 'confirmed', 'preparing', 'ready', 'served', 'completed', 'cancelled'],
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
    phone: { type: String },
    isPhoneVerified: { type: Boolean, default: false },
    notes: { type: String }
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

  // Customer Rating & Feedback
  rating: { type: Number, min: 1, max: 5 },
  feedback: { type: String, trim: true },
  feedbackTags: [{ type: String }],
  ratedAt: { type: Date },

  // Razorpay Route Payment Details
  razorpay: {
    orderId: { type: String, sparse: true, index: true },
    paymentId: { type: String, sparse: true, index: true },
    signature: { type: String },
    transferId: { type: String, sparse: true },
    status: {
      type: String,
      enum: ['created', 'authorized', 'captured', 'failed', 'refunded'],
      default: 'created'
    },
    amount: { type: Number },
    currency: { type: String, default: 'INR' },
    platformCommissionPercent: { type: Number, default: 0 },
    platformFee: { type: Number, default: 0 },
    vendorAmount: { type: Number, default: 0 },
    vendorAccountId: { type: String },
    capturedAt: { type: Date },
    refundId: { type: String },
    refundAmount: { type: Number },
    refundStatus: { type: String },
    errorDescription: { type: String }
  },

  createdAt: { type: Date, default: Date.now }
});

// Indexes for high-speed querying of a tenant's orders
orderSchema.index({ tenantId: 1, createdAt: -1 });
orderSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
orderSchema.index({ tenantId: 1, tableNumber: 1, status: 1 });

// Ensure total and totalAmount are always synchronized
orderSchema.pre('save', function (next) {
  if (this.total !== undefined && this.total !== null) {
    this.totalAmount = this.total;
  } else if (this.totalAmount !== undefined && this.totalAmount !== null) {
    this.total = this.totalAmount;
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);
const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, trim: true },
  phone: { type: String, trim: true },
  address: { type: String, trim: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  gstNumber: { type: String, trim: true },
  logo: { type: String, trim: true },
  domain: { type: String, unique: true, sparse: true, trim: true }, // For custom domains
  operatingMode: {
    type: String,
    enum: ['dine_in', 'counter_billing'],
    default: 'dine_in'
  },
  subscription: {
    plan: {
      type: String,
      default: 'pro'
    },
    price: { type: Number, default: 999 },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date },
    isActive: { type: Boolean, default: true },
    refundDue: { type: Number, default: 0 },
    remainingDays: { type: Number, default: 0 },
    deactivatedAt: { type: Date },
    orderLimit: { type: Number, default: 999999 },
    orderCount: { type: Number, default: 0 },
    modules: [{ type: String }],
    customAddons: [{ type: String }],
    features: {
      emailSupport: { type: Boolean, default: true },
      prioritySupport: { type: Boolean, default: true },
      customBranding: { type: Boolean, default: true },
      orderTimer: { type: Boolean, default: true },
      advancedAnalytics: { type: Boolean, default: true }
    }
  },
  subscriptionHistory: [
    {
      plan: { type: String },
      price: { type: Number },
      startDate: { type: Date },
      endDate: { type: Date },
      status: { type: String, default: 'active' },
      actionDate: { type: Date, default: Date.now },
      notes: { type: String }
    }
  ],
  settings: {
    operatingMode: { type: String, enum: ['dine_in', 'counter_billing'], default: 'dine_in' },
    currency: { type: String, default: 'INR' },
    theme: { type: String, default: 'default' },
    taxPercentage: { type: Number, default: 5 }, // GST %
    logo: { type: String }, // URL to logo
    enableEstimatedPrepTime: { type: Boolean, default: false }, // Kitchen prep time estimation toggle (default OFF)
    enableKhata: { type: Boolean, default: false }, // Indian customer credit / borrow (Udhari) toggle (default OFF)
    enableCustomerOtp: { type: Boolean, default: true }, // SMS OTP & Google Verification for Customer Orders (default ON)
    language: { type: String, default: 'en' }, // 'en' or 'hi'
    enableNightMenu: { type: Boolean, default: false }, // Special Open/Night Menu (POS Only)
    nightMenuStart: { type: String, default: '22:00' }, // Night menu start time e.g. 10:00 PM
    nightMenuEnd: { type: String, default: '05:00' }, // Night menu end time e.g. 05:00 AM
    upiId: { type: String, trim: true }, // Cafe Owner's direct UPI ID (e.g. cafe@okaxis, 9351862675@paytm)
    upiPayeeName: { type: String, trim: true }, // Display name for UPI (e.g. Cafee Delight)
    enableDirectUpi: { type: Boolean, default: true }, // Instant Direct UPI Payments
    categories: {
      type: [{ name: String, id: String, icon: String }],
      default: [
        { id: "all", name: "All", icon: "UtensilsCrossed" }
      ]
    }
  },
  razorpay: {
    accountId: { type: String, trim: true, sparse: true },
    accountStatus: {
      type: String,
      enum: ['unlinked', 'created', 'activated', 'under_review', 'suspended', 'rejected'],
      default: 'unlinked'
    },
    businessName: { type: String, trim: true },
    legalName: { type: String, trim: true },
    email: { type: String, trim: true },
    phone: { type: String, trim: true },
    accountType: { type: String, default: 'standard' },
    bankAccountNumber: { type: String, trim: true },
    bankIfsc: { type: String, trim: true },
    commissionPercent: { type: Number, default: 0 },
    isLive: { type: Boolean, default: false },
    linkedAt: { type: Date },
    rawAccountDetails: { type: mongoose.Schema.Types.Mixed }
  },
  analytics: {
    historicalRevenue: { type: Number, default: 0 },
    historicalOrderCount: { type: Number, default: 0 }
  },
  createdAt: { type: Date, default: Date.now }
});

// Index for faster lookups
tenantSchema.index({ 'subscription.isActive': 1 });

module.exports = mongoose.model('Tenant', tenantSchema);

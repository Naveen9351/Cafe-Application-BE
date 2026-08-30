const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, trim: true },
  phone: { type: String, trim: true },
  address: { type: String, trim: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  gstNumber: { type: String, trim: true },
  domain: { type: String, unique: true, sparse: true, trim: true }, // For custom domains
  subscription: {
    plan: {
      type: String,
      enum: ['free_trial', 'basic', 'pro', 'enterprise'], // basic = 100rs, pro = 500rs? User said: 1. Free, 2. 100rs (Pro?), 3. 500rs (Enterprise)
      default: 'free_trial'
    },
    price: { type: Number, default: 0 },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date },
    isActive: { type: Boolean, default: true },
    orderLimit: { type: Number, default: 50 }, // Default for free trial
    orderCount: { type: Number, default: 0 }, // Track usages this month
    features: {
      emailSupport: { type: Boolean, default: false },
      prioritySupport: { type: Boolean, default: false },
      customBranding: { type: Boolean, default: false },
      orderTimer: { type: Boolean, default: false },
      advancedAnalytics: { type: Boolean, default: false }
    }
  },
  settings: {
    currency: { type: String, default: 'INR' },
    theme: { type: String, default: 'default' },
    taxPercentage: { type: Number, default: 5 }, // GST %
    logo: { type: String }, // URL to logo
    categories: {
      type: [{ name: String, id: String, icon: String }],
      default: [
        { id: "all", name: "All", icon: "UtensilsCrossed" },
        { id: "chai", name: "Chai", icon: "Coffee" },
        { id: "cold-coffee", name: "Cold Coffee", icon: "Coffee" },
        { id: "hot-coffee", name: "Hot Coffee", icon: "Coffee" },
        { id: "burger", name: "Burger", icon: "Sandwich" },
        { id: "pizza", name: "Pizza", icon: "Pizza" },
        { id: "chinese", name: "Chinese", icon: "Soup" },
        { id: "sandwich", name: "Sandwich", icon: "Sandwich" },
        { id: "snacks", name: "Snacks", icon: "Cookie" },
        { id: "wraps", name: "Wraps", icon: "Sandwich" },
        { id: "pasta", name: "Pasta", icon: "UtensilsCrossed" },
        { id: "cold-drinks", name: "Drinks", icon: "GlassWater" },
        { id: "mocktails", name: "Mocktails", icon: "Martini" },
        { id: "shakes", name: "Shakes", icon: "IceCream" },
        { id: "desserts", name: "Desserts", icon: "Cake" }
      ]
    }
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

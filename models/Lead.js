const mongoose = require('mongoose');

const LeadSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
    trim: true
  },
  workEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  restaurantName: {
    type: String,
    required: true,
    trim: true
  },
  outletType: {
    type: String,
    default: 'Cafe / Coffee Shop'
  },
  locationsCount: {
    type: String,
    default: '1 outlet'
  },
  city: {
    type: String,
    default: 'Bangalore'
  },
  interests: [{
    type: String
  }],
  preferredTime: {
    type: String,
    default: 'Anytime'
  },
  notes: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['new', 'contacted', 'demo_scheduled', 'converted', 'closed'],
    default: 'new'
  },
  source: {
    type: String,
    default: 'website_landing'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Lead', LeadSchema);

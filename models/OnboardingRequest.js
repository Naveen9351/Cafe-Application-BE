const mongoose = require('mongoose');

const onboardingRequestSchema = new mongoose.Schema({
  businessName: {
    type: String,
    required: true,
    trim: true
  },
  ownerName: {
    type: String,
    trim: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  phone: {
    type: String,
    trim: true,
    default: ''
  },
  password: {
    type: String,
    default: ''
  },
  address: {
    type: String,
    trim: true
  },
  city: {
    type: String,
    trim: true
  },
  gstNumber: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['invited', 'pending_approval', 'approved', 'rejected'],
    default: 'pending_approval',
    index: true
  },
  isSubmitted: {
    type: Boolean,
    default: false,
    index: true
  },
  submittedAt: {
    type: Date
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  otp: {
    type: String
  },
  otpExpiresAt: {
    type: Date
  },
  source: {
    type: String,
    enum: ['public_register', 'admin_invite'],
    default: 'public_register'
  },
  inviteToken: {
    type: String,
    sparse: true,
    index: true
  },
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  requestedPlan: {
    type: String,
    default: 'free_trial'
  },
  rejectionReason: {
    type: String,
    trim: true
  },
  reviewedAt: {
    type: Date
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdTenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant'
  },
  createdUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

module.exports = mongoose.model('OnboardingRequest', onboardingRequestSchema);


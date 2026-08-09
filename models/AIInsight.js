const mongoose = require('mongoose');

const AIInsightSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  type: {
    type: String,
    enum: ['sales_analysis', 'inventory_warning', 'demand_forecast', 'marketing_suggestion'],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  recommendations: [{
    type: String
  }],
  isResolved: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('AIInsight', AIInsightSchema);

const mongoose = require('mongoose');

const ReservationSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  outletId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Outlet'
  },
  tableId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Table'
  },
  customerName: {
    type: String,
    required: true
  },
  customerPhone: {
    type: String,
    required: true
  },
  reservationTime: {
    type: Date,
    required: true
  },
  guestsCount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'waiting', 'completed', 'cancelled', 'no_show'],
    default: 'pending'
  },
  notes: {
    type: String
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Reservation', ReservationSchema);

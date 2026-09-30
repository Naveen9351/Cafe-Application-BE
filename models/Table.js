const mongoose = require('mongoose');

const TableSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  outletId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Outlet'
  },
  tableNumber: {
    type: String,
    required: true
  },
  seatingCapacity: {
    type: Number,
    default: 4
  },
  status: {
    type: String,
    enum: ['available', 'occupied', 'ordering', 'preparing', 'bill_requested', 'payment_pending', 'reserved', 'cleaning'],
    default: 'available'
  },
  qrUrl: {
    type: String
  }
}, {
  timestamps: true
});

TableSchema.index({ tenantId: 1, tableNumber: 1 });

module.exports = mongoose.model('Table', TableSchema);

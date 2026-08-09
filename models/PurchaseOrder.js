const mongoose = require('mongoose');

const purchaseOrderSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  supplierId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true
  },
  items: [
    {
      inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', required: true },
      quantity: { type: Number, required: true },
      costPerUnit: { type: Number, required: true }
    }
  ],
  totalAmount: { type: Number, required: true },
  status: {
    type: String,
    enum: ['pending', 'ordered', 'received', 'cancelled'],
    default: 'pending'
  },
  notes: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);

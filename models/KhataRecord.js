const mongoose = require('mongoose');

const khataRecordSchema = new mongoose.Schema({
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tenant',
        required: true
    },
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order'
    },
    orderNumber: { type: String },
    customerName: { type: String, required: true, trim: true },
    customerPhone: { type: String, required: true, trim: true },
    totalBill: { type: Number, required: true },
    paidAmount: { type: Number, default: 0 },
    borrowAmount: { type: Number, required: true }, // Outstanding amount
    status: {
        type: String,
        enum: ['pending', 'partially_settled', 'settled'],
        default: 'pending'
    },
    settlementHistory: [
        {
            amount: { type: Number },
            paymentMethod: { type: String, enum: ['cash', 'upi', 'card'], default: 'cash' },
            settledAt: { type: Date, default: Date.now },
            settledBy: { type: String },
            notes: { type: String }
        }
    ],
    notes: { type: String },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

khataRecordSchema.index({ tenantId: 1, customerPhone: 1, status: 1 });

module.exports = mongoose.model('KhataRecord', khataRecordSchema);

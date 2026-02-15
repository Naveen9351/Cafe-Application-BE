const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tenant',
        required: true,
        index: true
    },
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: true
    },
    invoiceNumber: {
        type: String,
        required: true,
        // unique: true // Note: You might want uniqueness per tenant, difficult with simple unique index.
    },
    gstNumber: { type: String }, // Business GST at time of invoice
    customerName: { type: String },
    customerPhone: { type: String },

    items: [
        {
            name: { type: String, required: true },
            quantity: { type: Number, required: true },
            price: { type: Number, required: true },
            total: { type: Number, required: true }
        }
    ],

    subTotal: { type: Number, required: true },
    taxAmount: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },

    paymentMethod: {
        type: String,
        enum: ['cash', 'card', 'upi', 'online'],
        default: 'cash'
    },

    createdAt: { type: Date, default: Date.now }
});

// Index for looking up invoices per tenant
invoiceSchema.index({ tenantId: 1, invoiceNumber: 1 });

module.exports = mongoose.model('Invoice', invoiceSchema);

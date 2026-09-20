const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema({
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tenant',
        required: true
    },
    tenantName: { type: String, trim: true },
    ticketNumber: { type: String, required: true },
    subject: { type: String, required: true, trim: true },
    category: {
        type: String,
        enum: ['POS Terminal', 'Billing & Taxes', 'Kitchen KDS', 'QR Menu', 'Bug Report', 'Feature Request', 'Other'],
        default: 'POS Terminal'
    },
    description: { type: String, required: true },
    priority: {
        type: String,
        enum: ['low', 'normal', 'high', 'urgent'],
        default: 'normal'
    },
    status: {
        type: String,
        enum: ['open', 'in_progress', 'resolved', 'closed'],
        default: 'open'
    },
    screenshotUrl: { type: String }, // Base64 or uploaded URL
    contactEmail: { type: String, trim: true },
    contactPhone: { type: String, trim: true },
    adminNotes: { type: String },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

supportTicketSchema.index({ tenantId: 1, status: 1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);

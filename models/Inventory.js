const mongoose = require('mongoose');

const inventorySchema = new mongoose.Schema({
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tenant',
        required: true,
        index: true
    },
    itemName: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: {
        type: String,
        enum: ['kg', 'g', 'ltr', 'ml', 'pcs', 'packs', 'boxes'],
        required: true
    },
    threshold: { type: Number, default: 5 }, // Low stock alert level
    costPerUnit: { type: Number, default: 0 },
    lastRestocked: { type: Date, default: Date.now },
    supplier: { type: String, trim: true }
});

inventorySchema.index({ tenantId: 1, itemName: 1 });

module.exports = mongoose.model('Inventory', inventorySchema);

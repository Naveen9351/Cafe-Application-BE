const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  price: { type: Number, required: true, min: 0 },
  category: { type: String, default: 'general', index: true },
  image: { type: String, required: true }, // Cloudinary URL
  isAvailable: { type: Boolean, default: true },
  preparationTime: { type: Number, default: 15 }, // Minutes
  taxRate: { type: Number, default: 0 }, // Specific item tax override
  variants: [
    {
      name: { type: String, required: true },
      price: { type: Number, required: true }
    }
  ],
  addons: [
    {
      name: { type: String, required: true },
      price: { type: Number, default: 0 }
    }
  ],
  recipe: [
    {
      inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', required: true },
      quantity: { type: Number, required: true }
    }
  ],
  createdAt: { type: Date, default: Date.now }
});

// Composite index for uniqueness within a tenant (optional but good practice)
// menuItemSchema.index({ tenantId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('MenuItem', menuItemSchema);
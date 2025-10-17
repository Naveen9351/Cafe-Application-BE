const mongoose = require('mongoose');
const OrderSchema = new mongoose.Schema({
  tableNumber: { type: String, required: true },
  items: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true }],
  quantities: [{ type: Number, required: true }],
  total: { type: Number, required: true },
  status: { type: String, default: 'pending' },
  estimatedTime: { type: Number }, // Time in minutes
  timeSetAt: { type: Date }, // Timestamp when estimatedTime was set
  createdAt: { type: Date, default: Date.now },
});
module.exports = mongoose.model('Order', OrderSchema);
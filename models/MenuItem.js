const mongoose = require('mongoose');
const menuSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  price: { type: Number, required: true, min: 0 },
  category: { type: String, default: 'general' },
  image: { type: String, required: true }, // Cloudinary URL
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('MenuItem', menuSchema);
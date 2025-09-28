const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const auth = require('../middleware/auth');
const MenuItem = require('../models/MenuItem');
const Order = require('../models/Order');
const User = require('../models/User');

// Configure Cloudinary
try {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  console.log('Cloudinary configured successfully');
} catch (err) {
  console.error('Cloudinary configuration error:', err);
}

const upload = multer({ dest: 'uploads/' });

// Login endpoint
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Invalid email format'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;
    try {
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(400).json({ error: 'Invalid credentials' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ error: 'Invalid credentials' });
      }

      const payload = { id: user._id, role: user.role };
      const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
      res.json({ token });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// Add menu item endpoint
router.post(
  '/items',
  [
    auth,
    upload.single('image'),
    body('name').notEmpty().withMessage('Name is required'),
    body('description').notEmpty().withMessage('Description is required'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('category').notEmpty().withMessage('Category is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { name, description, price, category } = req.body;
      if (!req.file) {
        return res.status(400).json({ error: 'Image is required' });
      }

      if (!cloudinary.config().cloud_name || !cloudinary.config().api_key || !cloudinary.config().api_secret) {
        console.error('Cloudinary configuration missing');
        return res.status(500).json({ error: 'Cloudinary configuration error' });
      }

      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: 'menu_items',
      });
      const item = new MenuItem({
        name,
        description,
        price: parseFloat(price),
        category,
        image: result.secure_url,
      });
      await item.save();
      res.json(item);
    } catch (err) {
      console.error('Add item error:', err.message, err.stack);
      res.status(500).json({ error: 'Failed to add item: ' + err.message });
    }
  }
);

// Edit menu item endpoint
router.put(
  '/items/:id',
  [
    auth,
    upload.single('image'),
    body('name').notEmpty().withMessage('Name is required'),
    body('description').notEmpty().withMessage('Description is required'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('category').notEmpty().withMessage('Category is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { name, description, price, category } = req.body;
      const updateData = {
        name,
        description,
        price: parseFloat(price),
        category,
      };

      if (req.file) {
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: 'menu_items',
        });
        updateData.image = result.secure_url;
      }

      const item = await MenuItem.findByIdAndUpdate(req.params.id, updateData, { new: true });
      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }
      res.json(item);
    } catch (err) {
      console.error('Edit item error:', err.message, err.stack);
      res.status(500).json({ error: 'Failed to edit item: ' + err.message });
    }
  }
);

// Delete menu item endpoint
router.delete('/items/:id', auth, async (req, res) => {
  try {
    const item = await MenuItem.findByIdAndDelete(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }
    res.json({ message: 'Item deleted successfully' });
  } catch (err) {
    console.error('Delete item error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update order time endpoint
router.put(
  '/orders/:id/time',
  [
    auth,
    body('time').isFloat({ min: 1 }).withMessage('Estimated time must be a positive number in minutes'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { time } = req.body;
      const order = await Order.findByIdAndUpdate(
        req.params.id,
        { estimatedTime: parseFloat(time), timeSetAt: new Date(), status: 'preparing' },
        { new: true }
      ).populate('items');

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      if (global.io) {
        global.io.emit('orderUpdate', order);
      }
      res.json(order);
    } catch (err) {
      console.error('Update order time error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// Update order status endpoint
router.put('/orders/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['preparing', 'done', 'canceled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const updateData = { status };
    if (status !== 'preparing') {
      updateData.estimatedTime = null;
      updateData.timeSetAt = null;
    }

    const order = await Order.findByIdAndUpdate(req.params.id, updateData, { new: true }).populate('items');

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (global.io) {
      global.io.emit('orderUpdate', order);
    }
    res.json(order);
  } catch (err) {
    console.error('Update order status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete order endpoint
router.delete('/orders/:id', auth, async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (global.io) {
      global.io.emit('orderDeleted', { id: req.params.id });
    }
    res.json({ message: 'Order deleted successfully' });
  } catch (err) {
    console.error('Delete order error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all orders endpoint
router.get('/orders', auth, async (req, res) => {
  try {
    const orders = await Order.find().populate('items').sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    console.error('Get orders error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
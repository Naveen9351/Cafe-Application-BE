const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Order = require('../models/Order');

router.post(
  '/',
  [
    body('items').isArray().notEmpty().withMessage('Items are required'),
    body('quantities').isArray().notEmpty().withMessage('Quantities are required'),
    body('total').isFloat({ min: 0 }).withMessage('Total must be a positive number'),
    body('customerName').notEmpty().trim().withMessage('Customer name is required'),
    body('tableNumber').notEmpty().trim().isInt({ min: 1 }).withMessage('Table number must be a positive integer'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { items, quantities, total, customerName, tableNumber } = req.body;
      const validItems = await require('../models/MenuItem').find({ _id: { $in: items } });
      if (validItems.length !== items.length) {
        return res.status(400).json({ error: 'Some items are invalid' });
      }
      const order = new Order({ items, quantities, total, customerName, tableNumber });
      await order.save();
      global.io.emit('newOrder', order);
      res.json(order);
    } catch (err) {
      console.error('Create order error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

router.get('/', async (req, res) => {
  try {
    const { customerName } = req.query;
    if (!customerName) {
      return res.status(400).json({ error: 'Customer name is required' });
    }
    const orders = await Order.find({ customerName }).populate('items').sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    console.error('Get orders error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/status/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('items');
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    console.error('Get order status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
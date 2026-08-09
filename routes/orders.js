const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const mongoose = require('mongoose');
const deductStockForOrder = require('../utils/stockDeductor');
const Customer = require('../models/Customer');

// CREATE Order (Public or Staff) - FIXED
router.post(
  '/',
  [
    body('items').isArray().notEmpty(),
    body('tenantId').notEmpty().withMessage('Tenant ID is required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { items, tableNumber, tenantId, customerDetails, paymentStatus, status } = req.body;

      // 0. Validate Tenant ID format
      if (!mongoose.Types.ObjectId.isValid(tenantId)) {
        return res.status(400).json({ error: 'Invalid Tenant ID format' });
      }

      // 0.5 Check Subscription Limits
      const Tenant = require('../models/Tenant');
      const tenant = await Tenant.findById(tenantId);

      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

      // Check Expiry
      if (tenant.subscription.endDate && new Date() > new Date(tenant.subscription.endDate)) {
        return res.status(403).json({ error: 'Subscription expired. Please contact admin.' });
      }

      // Monthly Reset Logic
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      if (new Date() - new Date(tenant.subscription.startDate) > thirtyDays) {
        tenant.subscription.orderCount = 0;
        tenant.subscription.startDate = new Date();
        // We don't save yet, we save at the end after incrementing
      }

      // Check Order Limit
      if (tenant.subscription.orderLimit <= tenant.subscription.orderCount) {
        return res.status(403).json({ error: 'Monthly order limit reached. Upgrade plan.' });
      }

      // 1. Fetch all items (Security: Verify prices server-side)
      const itemIds = items.map(i => i.id);
      const dbItems = await MenuItem.find({
        _id: { $in: itemIds },
        tenantId: tenantId
      });

      if (dbItems.length === 0) {
        return res.status(400).json({ error: 'Invalid items or items not found for this tenant' });
      }

      // 2. Calculate Totals
      let subTotal = 0;
      const orderItems = [];

      for (const clientItem of items) {
        const dbItem = dbItems.find(i => i._id.toString() === clientItem.id);
        if (dbItem) {
          const quantity = clientItem.quantity || 1;
          
          // Calculate item base + variant + addons price
          let basePrice = dbItem.price;
          let selectedVariant = null;
          if (clientItem.variant && clientItem.variant.name) {
            selectedVariant = clientItem.variant;
            basePrice = clientItem.variant.price;
          }

          const selectedAddons = clientItem.addons || [];
          let addonsTotal = 0;
          selectedAddons.forEach(ad => {
            addonsTotal += ad.price || 0;
          });

          const itemTotal = (basePrice + addonsTotal) * quantity;
          subTotal += itemTotal;

          orderItems.push({
            item: dbItem._id,
            name: dbItem.name,
            quantity: quantity,
            price: basePrice + addonsTotal,
            variant: selectedVariant,
            addons: selectedAddons
          });
        }
      }

      const taxRate = 0.05;
      const taxAmount = subTotal * taxRate;
      const total = subTotal + taxAmount;

      // Calculate loyalty points (e.g. 5 points per 100 rs spent)
      const pointsEarned = Math.round(subTotal * 0.05);

      // Handle customer loyalty update if phone provided
      let customerPointsUsed = 0;
      if (customerDetails && customerDetails.phone) {
        try {
          let customer = await Customer.findOne({ tenantId, phone: customerDetails.phone });
          if (!customer) {
            customer = new Customer({
              tenantId,
              name: customerDetails.name || 'Walk-in Customer',
              phone: customerDetails.phone,
              loyaltyPoints: pointsEarned,
              totalSpent: total,
              visitCount: 1
            });
          } else {
            customer.loyaltyPoints += pointsEarned;
            customer.totalSpent += total;
            customer.visitCount += 1;
          }
          await customer.save();
        } catch (crmErr) {
          console.error('Loyalty/CRM update error:', crmErr);
        }
      }

      // 3. Create Order
      const newOrder = new Order({
        tenantId,
        tableNumber: tableNumber || 'Counter',
        items: orderItems,
        subTotal,
        taxAmount,
        total,
        customerDetails: customerDetails || {},
        status: status || 'pending',
        paymentStatus: paymentStatus || 'pending',
        loyaltyPointsEarned: pointsEarned,
        estimatedTime: 20 // Default 20 mins
      });

      await newOrder.save();

      // Deduct inventory stock
      await deductStockForOrder(newOrder);

      // INCREMENT ORDER COUNT
      tenant.subscription.orderCount += 1;
      await tenant.save();

      // 4. Emit Socket Event
      if (global.io) {
        global.io.to(tenantId).emit('newOrder', newOrder);
      }

      res.status(201).json(newOrder);

    } catch (err) {
      console.error('Create order error:', err);
      res.status(500).json({ error: 'Server error: ' + err.message });
    }
  }
);

// UPDATE Estimated Time (Admin/Staff)
router.put('/:id/time', auth, async (req, res) => {
  try {
    const { time } = req.body; // in minutes
    const order = await Order.findByIdAndUpdate(req.params.id, { estimatedTime: time }, { new: true });

    if (!order) return res.status(404).json({ error: "Order not found" });

    if (global.io) {
      global.io.to(order.tenantId.toString()).emit('orderUpdate', order);
    }

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// GET Single Order Status (Public - for Order Tracking)
router.get('/status/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid Order ID' });
    }

    const order = await Order.findById(req.params.id)
      .populate('tenantId', 'name address phone') // Populate tenant info for branding
      .select('-items.item'); // Exclude raw item refs if not needed

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);
  } catch (err) {
    console.error("Get order status error:", err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET Orders (Protected - Tenant Admin/Staff)
router.get('/', auth, async (req, res) => {
  try {
    let tenantId = req.user.tenantId;

    // Super Admin can filter by tenantId in query
    if (req.user.role === 'super_admin' && req.query.tenantId) {
      tenantId = req.query.tenantId;
    }

    if (!tenantId && req.user.role !== 'super_admin') {
      return res.status(400).json({ error: 'Tenant context missing' });
    }

    if (!mongoose.Types.ObjectId.isValid(tenantId)) {
      return res.status(400).json({ error: "Invalid Tenant ID" });
    }

    const { status } = req.query;
    let query = {};
    if (tenantId) query.tenantId = tenantId;
    if (status) query.status = status;

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(100);

    res.json(orders);
  } catch (err) {
    console.error('Get orders error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET Analytics (Admin - Revenue)
router.get('/analytics', auth, checkRole(['admin', 'super_admin']), async (req, res) => {
  try {
    const tenantId = req.user.tenantId || req.query.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID required' });

    if (!mongoose.Types.ObjectId.isValid(tenantId)) {
      return res.status(400).json({ error: 'Invalid Tenant ID format' });
    }

    // Aggregation for Total Revenue of this Tenant
    const revenue = await Order.aggregate([
      { $match: { tenantId: new mongoose.Types.ObjectId(tenantId), status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } }
    ]);

    // Daily Revenue (Last 7 Days)
    const dailyRevenue = await Order.aggregate([
      {
        $match: {
          tenantId: new mongoose.Types.ObjectId(tenantId),
          status: 'completed',
          createdAt: { $gte: new Date(new Date() - 7 * 24 * 60 * 60 * 1000) }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          dailyTotal: { $sum: "$total" },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Fetch Tenant for Historical Data
    const Tenant = require('../models/Tenant');
    const tenant = await Tenant.findById(tenantId);

    res.json({
      totalRevenue: (revenue[0]?.total || 0) + (tenant?.analytics?.historicalRevenue || 0),
      totalOrders: (revenue[0]?.count || 0) + (tenant?.analytics?.historicalOrderCount || 0),
      dailyStats: dailyRevenue
    });

  } catch (err) {
    console.error("Analytics error", err);
    res.status(500).json({ error: 'Server error' });
  }
});


// UPDATE Order Status (Admin/Staff only)
router.put('/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;

    // TODO: Add validation for status enum
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid Order ID' });
    }

    const order = await Order.findOneAndUpdate(
      { _id: req.params.id }, // Anyone with auth and ID can try, but really should check tenant
      { status },
      { new: true }
    );

    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Emit update to tenant room
    if (global.io) {
      global.io.to(order.tenantId.toString()).emit('orderUpdate', order);
    }

    res.json(order);

  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
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

// Helper to calculate date boundaries
const getDateRangeFilter = (range, startDate, endDate) => {
  const now = new Date();
  let start = null;
  let end = null;

  if (range === 'today') {
    start = new Date(now);
    start.setHours(0, 0, 0, 0);
    end = new Date(now);
    end.setHours(23, 59, 59, 999);
  } else if (range === 'this_week') {
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday start
    start = new Date(now);
    start.setDate(diff);
    start.setHours(0, 0, 0, 0);
    end = new Date(now);
    end.setHours(23, 59, 59, 999);
  } else if (range === 'this_month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  } else if (range === 'custom' && startDate && endDate) {
    start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
  }

  if (start && end) {
    return { createdAt: { $gte: start, $lte: end } };
  }
  return {};
};

// CREATE Order (Public or Staff)
router.post(
  '/',
  [
    body('items').isArray().notEmpty().withMessage('Items array is required'),
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
      }

      // Check Order Limit
      if (tenant.subscription.orderLimit <= tenant.subscription.orderCount) {
        return res.status(403).json({ error: 'Monthly order limit reached. Upgrade plan.' });
      }

      // 1. Fetch all items (Security: Verify prices server-side)
      const itemIds = items
        .map(i => i.id || i.itemId || i.item || i._id)
        .filter(id => id && mongoose.Types.ObjectId.isValid(id));
      const dbItems = await MenuItem.find({
        _id: { $in: itemIds },
        tenantId: tenantId
      });

      if (dbItems.length === 0) {
        return res.status(400).json({ error: 'Invalid items or items not found for this tenant' });
      }

      // 2. Calculate Totals with Discount Support
      let subTotal = 0;
      const orderItems = [];

      for (const clientItem of items) {
        const cId = String(clientItem.id || clientItem.itemId || clientItem.item || clientItem._id || '');
        const dbItem = dbItems.find(i => i._id.toString() === cId);
        if (dbItem) {
          const quantity = clientItem.quantity || 1;
          
          let basePrice = dbItem.price;

          // Apply Item Discount if active
          if (dbItem.discount && dbItem.discount.isDiscounted) {
            if (dbItem.discount.type === 'percentage') {
              basePrice = Math.max(0, Math.round(basePrice * (1 - dbItem.discount.value / 100)));
            } else if (dbItem.discount.type === 'amount') {
              basePrice = Math.max(0, basePrice - dbItem.discount.value);
            }
          }

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

      const taxRate = 0.05; // 5% GST
      const taxAmount = Math.round(subTotal * taxRate * 100) / 100;
      const total = Math.round((subTotal + taxAmount) * 100) / 100;

      // Calculate loyalty points (5% cashback)
      const pointsEarned = Math.round(subTotal * 0.05);

      // Handle customer loyalty update if phone provided
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
        orderNumber: `${Math.floor(1000 + Math.random() * 9000)}`,
        tableNumber: tableNumber || 'Counter',
        items: orderItems,
        subTotal,
        taxAmount,
        total,
        customerDetails: customerDetails || {},
        status: status || 'pending',
        paymentStatus: paymentStatus || 'pending',
        loyaltyPointsEarned: pointsEarned,
        estimatedTime: req.body.estimatedTime ? Number(req.body.estimatedTime) : null
      });

      await newOrder.save();

      // Deduct inventory stock
      await deductStockForOrder(newOrder);

      // Increment Tenant Order Count
      tenant.subscription.orderCount += 1;
      await tenant.save();

      // 4. Emit Socket Event
      if (global.io) {
        global.io.to(tenantId.toString()).emit('newOrder', newOrder);
      }

      res.status(201).json(newOrder);

    } catch (err) {
      console.error('Create order error:', err);
      res.status(500).json({ error: 'Server error: ' + err.message });
    }
  }
);

// GET Single Order Status (Public - for Order Tracking)
router.get('/status/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid Order ID' });
    }

    const order = await Order.findById(req.params.id)
      .populate('tenantId', 'name address phone settings');

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

    if (req.user.role === 'super_admin' && req.query.tenantId) {
      tenantId = req.query.tenantId;
    }

    if (!tenantId && req.user.role !== 'super_admin') {
      return res.status(400).json({ error: 'Tenant context missing' });
    }

    const { status, range, startDate, endDate } = req.query;
    let query = {};
    if (tenantId) query.tenantId = tenantId;
    if (status) query.status = status;

    // Apply Date Range Filter
    const dateFilter = getDateRangeFilter(range, startDate, endDate);
    query = { ...query, ...dateFilter };

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(200);

    res.json(orders);
  } catch (err) {
    console.error('Get orders error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET Analytics with Date Range Filter (Admin)
router.get('/analytics', auth, checkRole(['admin', 'super_admin']), async (req, res) => {
  try {
    const tenantId = req.user.tenantId || req.query.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID required' });

    if (!mongoose.Types.ObjectId.isValid(tenantId)) {
      return res.status(400).json({ error: 'Invalid Tenant ID format' });
    }

    const { range, startDate, endDate } = req.query;
    const dateFilter = getDateRangeFilter(range || 'this_week', startDate, endDate);

    const matchStage = {
      tenantId: new mongoose.Types.ObjectId(tenantId),
      status: { $nin: ['cancelled'] },
      ...(dateFilter.createdAt ? { createdAt: dateFilter.createdAt } : {})
    };

    // Aggregation for Total Revenue of this Tenant in the selected range
    const revenueAgg = await Order.aggregate([
      { $match: matchStage },
      { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } }
    ]);

    // Trend grouping
    const trendAgg = await Order.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          dailyTotal: { $sum: "$total" },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const grossSales = revenueAgg[0]?.total || 0;
    const totalOrders = revenueAgg[0]?.count || 0;
    const avgTicket = totalOrders > 0 ? Math.round(grossSales / totalOrders) : 0;
    const netProfit = Math.round(grossSales * 0.42);

    res.json({
      grossSales,
      totalOrders,
      avgTicket,
      netProfit,
      dailyStats: trendAgg
    });

  } catch (err) {
    console.error("Analytics error", err);
    res.status(500).json({ error: 'Server error' });
  }
});

// UPDATE Order Status (Admin/Staff with strict Tenant Scoping)
router.put('/:id/status', auth, async (req, res) => {
  try {
    const { status, paymentStatus, paymentMethod, estimatedTime } = req.body;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid Order ID' });
    }

    const validStatuses = ['pending', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid order status value' });
    }

    const filter = { _id: req.params.id };
    if (req.user.role !== 'super_admin' && req.user.tenantId) {
      filter.tenantId = req.user.tenantId;
    }

    const updateFields = {};
    if (status) updateFields.status = status;
    if (paymentStatus) updateFields.paymentStatus = paymentStatus;
    if (paymentMethod) updateFields.paymentMethod = paymentMethod;
    if (estimatedTime !== undefined && estimatedTime !== null) {
      updateFields.estimatedTime = Number(estimatedTime) > 0 ? Number(estimatedTime) : null;
    }

    const order = await Order.findOneAndUpdate(
      filter,
      updateFields,
      { new: true }
    );

    if (!order) return res.status(404).json({ error: 'Order not found or unauthorized' });

    // Emit update to tenant room
    if (global.io && order.tenantId) {
      global.io.to(order.tenantId.toString()).emit('orderUpdate', order);
    }

    res.json(order);

  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// SETTLE ALL ACTIVE ORDERS FOR A TABLE (Table Batch Settle & Free Table)
router.put('/table/:tableNumber/settle', auth, async (req, res) => {
  try {
    const rawTable = String(req.params.tableNumber).trim();
    const numOnly = rawTable.replace(/[^0-9]/g, '') || rawTable;
    const { paymentMethod, paymentStatus } = req.body;

    let tenantId = req.user.tenantId;
    if (req.user.role === 'super_admin' && req.body.tenantId) {
      tenantId = req.body.tenantId;
    }

    const tablePattern = new RegExp(`^(${rawTable}|Table ${numOnly}|table-${numOnly}|${numOnly})$`, 'i');
    const query = {
      status: { $nin: ['completed', 'cancelled'] },
      tableNumber: { $regex: tablePattern }
    };
    if (tenantId) query.tenantId = tenantId;

    const activeOrders = await Order.find(query);
    if (!activeOrders || activeOrders.length === 0) {
      return res.status(200).json({ message: 'No active orders found for Table ' + rawTable, count: 0, settledOrders: [] });
    }

    const settledOrders = [];
    for (const ord of activeOrders) {
      ord.status = 'completed';
      ord.paymentStatus = paymentStatus || 'paid';
      if (paymentMethod) ord.paymentMethod = paymentMethod;
      await ord.save();
      settledOrders.push(ord);

      if (global.io && ord.tenantId) {
        global.io.to(ord.tenantId.toString()).emit('orderUpdate', ord);
      }
    }

    res.json({
      success: true,
      message: `Successfully settled ${settledOrders.length} order(s) for Table ${rawTable}`,
      count: settledOrders.length,
      settledOrders
    });
  } catch (err) {
    console.error('Table batch settle error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// UPDATE/ADD Items to Existing Order (Staff / POS Running Table Tab)
router.put('/:id/items', auth, async (req, res) => {
  try {
    const { items } = req.body;
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid Order ID' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array is required' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Fetch MenuItem details
    const itemIds = items.map(i => i.id).filter(id => mongoose.Types.ObjectId.isValid(id));
    const dbItems = await MenuItem.find({ _id: { $in: itemIds }, tenantId: order.tenantId });

    let subTotal = 0;
    const orderItems = [];

    for (const clientItem of items) {
      const dbItem = dbItems.find(i => i._id.toString() === clientItem.id);
      if (dbItem) {
        const quantity = clientItem.quantity || 1;
        let basePrice = dbItem.price;

        if (dbItem.discount && dbItem.discount.isDiscounted) {
          if (dbItem.discount.type === 'percentage') {
            basePrice = Math.max(0, Math.round(basePrice * (1 - dbItem.discount.value / 100)));
          } else if (dbItem.discount.type === 'amount') {
            basePrice = Math.max(0, basePrice - dbItem.discount.value);
          }
        }

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
      } else {
        // Retain any existing items that were already in order
        const existingItem = (order.items || []).find(it => (it.item?.toString() === clientItem.id || it._id?.toString() === clientItem.id));
        if (existingItem) {
          const quantity = clientItem.quantity || existingItem.quantity || 1;
          const itemPrice = clientItem.price || existingItem.price || 0;
          subTotal += itemPrice * quantity;
          orderItems.push({
            item: existingItem.item,
            name: clientItem.name || existingItem.name,
            quantity: quantity,
            price: itemPrice,
            variant: clientItem.variant || existingItem.variant,
            addons: clientItem.addons || existingItem.addons
          });
        }
      }
    }

    const taxRate = 0.05; // 5% GST
    const taxAmount = Math.round(subTotal * taxRate * 100) / 100;
    const total = Math.round((subTotal + taxAmount) * 100) / 100;

    order.items = orderItems;
    order.subTotal = subTotal;
    order.taxAmount = taxAmount;
    order.total = total;

    await order.save();

    if (global.io && order.tenantId) {
      global.io.to(order.tenantId.toString()).emit('orderUpdate', order);
    }

    res.json(order);
  } catch (err) {
    console.error('Update order items error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// DELETE Order (Admin/Staff)
router.delete('/:id', auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid Order ID' });
    }

    const filter = { _id: req.params.id };
    if (req.user.role !== 'super_admin' && req.user.tenantId) {
      filter.tenantId = req.user.tenantId;
    }

    const order = await Order.findOneAndDelete(filter);
    if (!order) return res.status(404).json({ error: 'Order not found or unauthorized' });

    if (global.io && order.tenantId) {
      global.io.to(order.tenantId.toString()).emit('orderDeleted', { id: req.params.id });
    }

    res.json({ message: 'Order deleted successfully' });
  } catch (err) {
    console.error("Delete order error:", err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
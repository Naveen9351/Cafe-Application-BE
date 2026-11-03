const { generateMeaningfulOrderNumber } = require('../utils/orderNumberGenerator');
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const Inventory = require('../models/Inventory');
const MenuItem = require('../models/MenuItem');
const Supplier = require('../models/Supplier');
const PurchaseOrder = require('../models/PurchaseOrder');
const Wastage = require('../models/Wastage');
const Customer = require('../models/Customer');
const Order = require('../models/Order');

// ==========================================
// 1. INVENTORY & INGREDIENTS
// ==========================================

// Get all inventory ingredients
router.get('/inventory', auth, async (req, res) => {
  try {
    const ingredients = await Inventory.find({ tenantId: req.tenantId });
    res.json(ingredients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create/Add ingredient
router.post('/inventory', auth, checkRole(['admin']), async (req, res) => {
  try {
    const { itemName, quantity, unit, threshold, costPerUnit, supplier } = req.body;
    const item = new Inventory({
      tenantId: req.tenantId,
      itemName,
      quantity,
      unit,
      threshold: threshold || 5,
      costPerUnit: costPerUnit || 0,
      supplier
    });
    await item.save();
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update ingredient stock manually
router.put('/inventory/:id', auth, checkRole(['admin']), async (req, res) => {
  try {
    const item = await Inventory.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      req.body,
      { new: true }
    );
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 2. RECIPES
// ==========================================

// Get recipe for a MenuItem
router.get('/recipes/:menuItemId', auth, async (req, res) => {
  try {
    const menuItem = await MenuItem.findOne({ _id: req.params.menuItemId, tenantId: req.tenantId })
      .populate('recipe.inventoryId');
    if (!menuItem) return res.status(404).json({ error: 'Menu item not found' });
    res.json(menuItem.recipe || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save recipe for a MenuItem
router.post('/recipes/:menuItemId', auth, checkRole(['admin']), async (req, res) => {
  try {
    const { recipe } = req.body; // array of { inventoryId, quantity }
    const menuItem = await MenuItem.findOneAndUpdate(
      { _id: req.params.menuItemId, tenantId: req.tenantId },
      { recipe },
      { new: true }
    );
    if (!menuItem) return res.status(404).json({ error: 'Menu item not found' });
    res.json(menuItem);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. SUPPLIERS & PURCHASE ORDERS
// ==========================================

// Get all suppliers
router.get('/suppliers', auth, async (req, res) => {
  try {
    const suppliers = await Supplier.find({ tenantId: req.tenantId });
    res.json(suppliers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create Supplier
router.post('/suppliers', auth, checkRole(['admin']), async (req, res) => {
  try {
    const supplier = new Supplier({
      tenantId: req.tenantId,
      ...req.body
    });
    await supplier.save();
    res.status(201).json(supplier);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Purchase Orders
router.get('/purchase-orders', auth, async (req, res) => {
  try {
    const pos = await PurchaseOrder.find({ tenantId: req.tenantId })
      .populate('supplierId')
      .populate('items.inventoryId');
    res.json(pos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create Purchase Order
router.post('/purchase-orders', auth, checkRole(['admin']), async (req, res) => {
  try {
    const { supplierId, items, notes } = req.body;
    let totalAmount = 0;
    items.forEach(i => {
      totalAmount += i.quantity * i.costPerUnit;
    });

    const po = new PurchaseOrder({
      tenantId: req.tenantId,
      supplierId,
      items,
      totalAmount,
      status: 'pending',
      notes
    });
    await po.save();
    res.status(201).json(po);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Receive PO (Adds stock to inventory)
router.post('/purchase-orders/:id/receive', auth, checkRole(['admin']), async (req, res) => {
  try {
    const po = await PurchaseOrder.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!po) return res.status(404).json({ error: 'Purchase Order not found' });
    if (po.status === 'received') return res.status(400).json({ error: 'Already received' });

    // Update stock for each item
    for (const item of po.items) {
      await Inventory.findOneAndUpdate(
        { _id: item.inventoryId, tenantId: req.tenantId },
        {
          $inc: { quantity: item.quantity },
          $set: { costPerUnit: item.costPerUnit, lastRestocked: new Date() }
        }
      );
    }

    po.status = 'received';
    await po.save();
    res.json(po);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4. WASTAGE LOGS
// ==========================================

// Get wastage logs
router.get('/wastage', auth, async (req, res) => {
  try {
    const wastage = await Wastage.find({ tenantId: req.tenantId }).populate('inventoryId');
    res.json(wastage);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Log wastage
router.post('/wastage', auth, checkRole(['admin']), async (req, res) => {
  try {
    const { inventoryId, quantity, reason } = req.body;
    const invItem = await Inventory.findOne({ _id: inventoryId, tenantId: req.tenantId });
    if (!invItem) return res.status(404).json({ error: 'Inventory item not found' });

    const costLost = invItem.costPerUnit * quantity;

    const wastage = new Wastage({
      tenantId: req.tenantId,
      inventoryId,
      quantity,
      reason,
      costLost
    });

    // Deduct inventory
    invItem.quantity = Math.max(0, invItem.quantity - quantity);
    await invItem.save();
    await wastage.save();

    res.status(201).json(wastage);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5. CRM & LOYALTY
// ==========================================

// Get customer by phone number
router.get('/customers/:phone', auth, async (req, res) => {
  try {
    const customer = await Customer.findOne({ tenantId: req.tenantId, phone: req.params.phone });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add or update customer
router.post('/customers', auth, async (req, res) => {
  try {
    const { name, phone, email } = req.body;
    let customer = await Customer.findOne({ tenantId: req.tenantId, phone });
    if (customer) {
      if (name) customer.name = name;
      if (email) customer.email = email;
      await customer.save();
    } else {
      customer = new Customer({
        tenantId: req.tenantId,
        name,
        phone,
        email
      });
      await customer.save();
    }
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all customers (CRM List with complete order history, visit dates, spend, and verification status)
router.get('/customers', auth, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || req.headers['x-tenant-id'];
    const query = tenantId ? { tenantId } : {};

    let customers = await Customer.find(query).sort({ updatedAt: -1, createdAt: -1 });

    // Fetch tenant's orders to link order history and backfill if necessary
    const orders = await Order.find(query).sort({ createdAt: -1 });

    // Map customer phones to their orders
    const ordersByPhone = {};
    orders.forEach(ord => {
      const p = ord.customerDetails?.phone ? String(ord.customerDetails.phone).replace(/[^0-9]/g, '') : null;
      if (p) {
        if (!ordersByPhone[p]) ordersByPhone[p] = [];
        ordersByPhone[p].push(ord);
      }
    });

    // Backfill any customers from orders who may not be in the Customer collection yet
    for (const [phone, phoneOrders] of Object.entries(ordersByPhone)) {
      let cust = customers.find(c => c.phone === phone);
      const validPhoneOrders = phoneOrders.filter(o => o.status !== 'cancelled');
      const totalSpent = validPhoneOrders.reduce((sum, o) => sum + (Number(o.settledAmount || o.total) || 0), 0);
      const visitCount = validPhoneOrders.length;

      if (!cust) {
        const firstOrd = phoneOrders[phoneOrders.length - 1];
        const lastOrd = phoneOrders[0];
        const newCust = new Customer({
          tenantId: tenantId || firstOrd.tenantId,
          name: lastOrd.customerDetails?.name || 'Walk-in Guest',
          phone,
          loyaltyPoints: Math.round(totalSpent * 0.05),
          totalSpent,
          visitCount,
          isPhoneVerified: Boolean(lastOrd.customerDetails?.isPhoneVerified),
          firstVisit: firstOrd.createdAt || new Date(),
          lastVisit: lastOrd.createdAt || new Date()
        });
        await newCust.save();
        customers.push(newCust);
      }
    }

    // Build enriched customer objects (strictly excluding cancelled orders from visits and lifetime spend)
    const enriched = customers.map(cust => {
      const custObj = cust.toObject ? cust.toObject() : cust;
      const phoneClean = String(cust.phone || '').replace(/[^0-9]/g, '');
      const custOrders = ordersByPhone[phoneClean] || [];
      const validOrders = custOrders.filter(o => o.status !== 'cancelled');

      // Lifetime spend and visits must strictly exclude cancelled orders
      const totalVisits = custOrders.length > 0 ? validOrders.length : (cust.visitCount || 0);
      const lifetimeSpend = custOrders.length > 0 
        ? validOrders.reduce((sum, o) => sum + (Number(o.settledAmount || o.total) || 0), 0)
        : (cust.totalSpent || 0);
      const aov = totalVisits > 0 ? Math.round(lifetimeSpend / totalVisits) : 0;

      // Sync customer document in database if past cancelled orders caused discrepancy
      if (cust._id && custOrders.length > 0 && (cust.totalSpent !== lifetimeSpend || cust.visitCount !== totalVisits)) {
        Customer.updateOne({ _id: cust._id }, { $set: { totalSpent: lifetimeSpend, visitCount: totalVisits } }).catch(() => {});
      }

      const firstVisit = cust.firstVisit || (custOrders.length > 0 ? custOrders[custOrders.length - 1].createdAt : cust.createdAt);
      const lastVisit = cust.lastVisit || (custOrders.length > 0 ? custOrders[0].createdAt : cust.createdAt);

      // Customer tier calculation
      let tier = 'New';
      if (lifetimeSpend >= 2500 || totalVisits >= 6) {
        tier = 'VIP';
      } else if (totalVisits >= 2 || lifetimeSpend >= 800) {
        tier = 'Regular';
      }

      return {
        ...custObj,
        totalVisits,
        lifetimeSpend,
        averageOrderValue: aov,
        firstVisit,
        lastVisit,
        tier,
        isPhoneVerified: Boolean(cust.isPhoneVerified || custOrders.some(o => o.customerDetails?.isPhoneVerified)),
        orders: custOrders.map(o => ({
          _id: o._id,
          orderNumber: o.orderNumber,
          tableNumber: o.tableNumber,
          createdAt: o.createdAt,
          orderType: o.orderType || 'dine_in',
          subTotal: o.subTotal,
          taxAmount: o.taxAmount,
          total: o.total,
          settledAmount: o.settledAmount || o.total,
          paymentMethod: o.paymentMethod || 'UPI',
          paymentStatus: o.paymentStatus,
          status: o.status,
          items: o.items || []
        }))
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error('Fetch CRM customers error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 6. ONLINE ORDER MOCK (SWIGGY/ZOMATO ACCORDING TO PETPOOJA INTEGRATION)
// ==========================================

// Simulate an incoming online order webhook from Swiggy/Zomato
router.post('/aggregator-webhook-mock', auth, async (req, res) => {
  try {
    const { platform, items, customerName, customerPhone, total } = req.body;
    
    // Pick first menu item for mock order details or random fallback
    const menuItems = await MenuItem.find({ tenantId: req.tenantId });
    if (menuItems.length === 0) {
      return res.status(400).json({ error: 'Please add menu items first to receive online mock orders.' });
    }

    const orderItems = items.map(itm => {
      const matched = menuItems.find(mi => mi.name.toLowerCase() === itm.name.toLowerCase()) || menuItems[0];
      return {
        item: matched._id,
        name: matched.name,
        quantity: itm.quantity || 1,
        price: matched.price
      };
    });

    const subTotal = orderItems.reduce((acc, i) => acc + (i.price * i.quantity), 0);
    const taxAmount = subTotal * 0.05;
    const finalTotal = subTotal + taxAmount;

    const baseOrderNum = generateMeaningfulOrderNumber({ customerName: customerName || 'Online', date: new Date() });
    let uniqueOrderNum = baseOrderNum;
    let collisionIdx = 1;
    while (await Order.exists({ tenantId: req.tenantId, orderNumber: uniqueOrderNum })) {
      uniqueOrderNum = `${baseOrderNum}-${collisionIdx}`;
      collisionIdx++;
    }

    const mockOrder = new Order({
      tenantId: req.tenantId,
      orderNumber: uniqueOrderNum,
      tableNumber: `Online (${platform})`,
      orderType: 'online',
      items: orderItems,
      subTotal,
      taxAmount,
      total: finalTotal,
      customerDetails: {
        name: customerName || 'John Online',
        phone: customerPhone || '9999999999'
      },
      status: 'pending',
      paymentStatus: 'paid'
    });

    await mockOrder.save();

    // Emit socket event to notify POS terminal instantly
    if (global.io) {
      global.io.to(req.tenantId.toString()).emit('newOrder', mockOrder);
    }

    res.status(201).json({ message: 'Online order mock triggered', order: mockOrder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

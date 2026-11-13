const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const Invoice = require('../models/Invoice');
const Order = require('../models/Order');
const Tenant = require('../models/Tenant');

// Helper to resolve tenant ID securely
const getTenantId = (req) => {
  return req.tenantId || req.user?.tenantId || req.query.tenantId || req.body.tenantId;
};

// @route   GET /api/invoices
// @desc    List all tax invoices with date filters, search and pagination
// @access  Protected
router.get('/', auth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
      return res.status(400).json({ error: 'Valid Tenant ID is required' });
    }

    const { search, startDate, endDate, page = 1, limit = 50 } = req.query;
    const query = { tenantId: new mongoose.Types.ObjectId(tenantId) };

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    if (search && String(search).trim()) {
      const q = String(search).trim();
      query.$or = [
        { invoiceNumber: { $regex: q, $options: 'i' } },
        { customerName: { $regex: q, $options: 'i' } },
        { customerPhone: { $regex: q, $options: 'i' } },
        { tableNumber: { $regex: q, $options: 'i' } }
      ];
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [invoices, totalCount, aggregateStats] = await Promise.all([
      Invoice.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Invoice.countDocuments(query),
      Invoice.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalGross: { $sum: '$totalAmount' },
            totalTax: { $sum: '$taxAmount' },
            totalSubtotal: { $sum: '$subTotal' }
          }
        }
      ])
    ]);

    const stats = aggregateStats[0] || { totalGross: 0, totalTax: 0, totalSubtotal: 0 };

    res.json({
      success: true,
      invoices,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitNum)
      },
      summary: {
        totalGross: stats.totalGross,
        totalTax: stats.totalTax,
        totalSubtotal: stats.totalSubtotal,
        invoiceCount: totalCount
      }
    });
  } catch (err) {
    console.error('Fetch invoices error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// @route   POST /api/invoices/generate
// @desc    Generate a formal Tax Invoice for an order (or retrieve if already created)
// @access  Protected
router.post('/generate', auth, async (req, res) => {
  try {
    const { orderId } = req.body;
    const tenantId = getTenantId(req);

    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ error: 'Valid Order ID is required' });
    }

    // Check if an invoice already exists for this order
    let existingInvoice = await Invoice.findOne({ orderId }).lean();
    if (existingInvoice) {
      return res.json({
        success: true,
        invoice: existingInvoice,
        isExisting: true
      });
    }

    // Find Order
    const order = await Order.findById(orderId).populate('items.item');
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const orderTenantId = order.tenantId || tenantId;
    const tenant = await Tenant.findById(orderTenantId);

    // Generate unique sequential invoice number
    const currentYear = new Date().getFullYear();
    const invoiceCount = await Invoice.countDocuments({
      tenantId: orderTenantId,
      createdAt: {
        $gte: new Date(currentYear, 0, 1),
        $lte: new Date(currentYear, 11, 31, 23, 59, 59)
      }
    });

    const invoiceNumber = `INV-${currentYear}-${String(invoiceCount + 1).padStart(4, '0')}`;

    // Compute invoice lines
    const items = (order.items || []).map(it => {
      const name = it.name || it.item?.name || 'Dish Item';
      const variantStr = it.variant?.name ? ` (${it.variant.name})` : '';
      const qty = Number(it.quantity) || 1;
      const price = Number(it.price) || Number(it.item?.price) || 0;
      return {
        name: `${name}${variantStr}`,
        quantity: qty,
        price: price,
        total: qty * price
      };
    });

    const subTotal = items.reduce((sum, it) => sum + it.total, 0);
    const taxRate = tenant?.settings?.taxPercentage ?? 5;
    const taxAmount = Math.round(subTotal * (taxRate / 100));
    const discount = Number(order.discountAmount || 0);
    const totalAmount = Math.max(0, subTotal + taxAmount - discount);

    const newInvoice = new Invoice({
      tenantId: orderTenantId,
      orderId: order._id,
      invoiceNumber,
      gstNumber: tenant?.gstNumber || 'N/A',
      customerName: order.customerName || order.customerDetails?.name || 'Guest Diner',
      customerPhone: order.customerPhone || order.customerDetails?.phone || '',
      tableNumber: String(order.tableNumber || order.table || 'Counter'),
      channel: order.orderType || 'dine-in',
      items,
      subTotal,
      taxAmount,
      discount,
      totalAmount,
      paymentMethod: (order.paymentMethod || 'cash').toLowerCase(),
      createdAt: order.createdAt || new Date()
    });

    await newInvoice.save();

    res.status(201).json({
      success: true,
      invoice: newInvoice,
      isExisting: false
    });
  } catch (err) {
    console.error('Generate invoice error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// @route   GET /api/invoices/:id
// @desc    Get single invoice details
// @access  Protected
router.get('/:id', auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid Invoice ID' });
    }

    const invoice = await Invoice.findById(req.params.id)
      .populate('orderId')
      .lean();

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json({ success: true, invoice });
  } catch (err) {
    console.error('Get invoice details error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

module.exports = router;


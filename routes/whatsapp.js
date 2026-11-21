const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const checkModuleAccess = require('../middleware/checkModuleAccess');
const { MODULE_KEYS } = require('../config/subscriptionPlans');

// Guard all WhatsApp routes with module access check
router.use([auth, checkModuleAccess(MODULE_KEYS.WHATSAPP_SUITE)]);
const Order = require('../models/Order');
const Tenant = require('../models/Tenant');
const {
  getWhatsAppStatus,
  initWhatsApp,
  sendWhatsAppMessage,
  disconnectWhatsApp
} = require('../utils/whatsappService');

// Helper to resolve tenant ID securely
const resolveTenantId = async (req) => {
  let tenantId = req.tenantId || req.user?.tenantId || req.query?.tenantId || req.body?.tenantId || req.header('x-tenant-id');
  if (!tenantId || tenantId === 'undefined' || tenantId === 'null') {
    const defaultTenant = await Tenant.findOne().select('_id');
    if (defaultTenant) tenantId = defaultTenant._id;
  }
  return tenantId ? String(tenantId) : 'default';
};

// Format order into professional digital receipt text
const formatOrderReceipt = (order, tenant) => {
  const cafeName = tenant?.name || 'DINEVIQ CAFE & BISTRO';
  const gstin = tenant?.gstNumber || '';
  const orderNum = order.orderNumber || order._id?.toString()?.slice(-5) || 'ORD';
  const table = order.tableNumber || order.table || 'Counter Walk-in';
  const channel = (order.orderType || order.channel || 'dine-in').toUpperCase();
  const custName = order.customerName || order.customerDetails?.name || 'Valued Guest';

  const dateStr = order.createdAt
    ? new Date(order.createdAt).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      })
    : new Date().toLocaleString('en-IN');

  const items = (order.items || []).map(it => {
    const qty = Number(it.quantity) || 1;
    const price = Number(it.price || it.item?.price || 0);
    const itemTotal = qty * price;
    const name = it.name || it.item?.name || 'Dish Item';
    const variantStr = it.variant?.name ? ` (${it.variant.name})` : '';
    return `• ${qty}x ${name}${variantStr} - ₹${itemTotal}`;
  }).join('\n');

  const subtotal = Number(
    order.subTotal ||
    order.subtotal ||
    (order.items || []).reduce((s, i) => s + ((Number(i.price) || 0) * (Number(i.quantity) || 1)), 0) ||
    order.total ||
    0
  );
  const tax = Number(order.taxAmount || 0);
  const discount = Number(order.discountAmount || 0);
  const total = Number(order.totalAmount || order.finalAmount || order.total || (subtotal + tax - discount));
  const payMethod = (order.paymentMethod || 'Cash').toUpperCase();
  const payStatus = (order.paymentStatus || 'Paid').toUpperCase();

  let text = `🧾 *TAX INVOICE / E-BILL*\n`;
  text += `*${cafeName.toUpperCase()}*\n`;
  if (gstin) text += `GSTIN: ${gstin}\n`;
  text += `──────────────────────\n`;
  text += `*Order #:* ${orderNum}\n`;
  text += `*Date:* ${dateStr}\n`;
  text += `*Table / Type:* ${table} (${channel})\n`;
  text += `*Guest:* ${custName}\n`;
  text += `──────────────────────\n`;
  text += `*ITEMS ORDERED:*\n${items || '• Order Items'}\n`;
  text += `──────────────────────\n`;
  text += `Subtotal: ₹${subtotal}\n`;
  if (discount > 0) text += `Discount: -₹${discount}\n`;
  if (tax > 0) text += `Taxes & GST: +₹${tax}\n`;
  text += `*GRAND TOTAL: ₹${total}*\n`;
  text += `Payment: ${payMethod} (${payStatus === 'PAID' ? 'PAID ✅' : payStatus})\n`;
  text += `──────────────────────\n`;
  text += `✨ Thank you for dining with us! We hope to welcome you again soon. ☕🍕`;

  return text;
};

// @route   GET /api/whatsapp/status
// @desc    Get WhatsApp connection status & QR code for tenant
router.get('/status', async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req);
    const status = getWhatsAppStatus(tenantId);
    res.json({ success: true, ...status, tenantId });
  } catch (err) {
    console.error('WhatsApp status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// @route   POST /api/whatsapp/connect
// @desc    Initiate WhatsApp connection & request QR code
router.post('/connect', async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req);
    const { forceNew = false } = req.body;
    const status = await initWhatsApp(tenantId, forceNew);
    res.json({ success: true, ...status, tenantId });
  } catch (err) {
    console.error('WhatsApp connect error:', err);
    res.status(500).json({ error: err.message });
  }
});

// @route   POST /api/whatsapp/disconnect
// @desc    Unlink / log out WhatsApp session
router.post('/disconnect', async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req);
    await disconnectWhatsApp(tenantId);
    res.json({ success: true, message: 'WhatsApp session unlinked successfully.' });
  } catch (err) {
    console.error('WhatsApp disconnect error:', err);
    res.status(500).json({ error: err.message });
  }
});

// @route   POST /api/whatsapp/send-bill
// @desc    Send digital bill directly to customer's WhatsApp
router.post('/send-bill', async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req);
    const { orderId, phone, message } = req.body;

    let targetPhone = phone;
    let finalMessage = message;

    // If orderId is provided, enrich data
    if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
      const order = await Order.findById(orderId).populate('items.item').lean();
      if (order) {
        if (!targetPhone) {
          targetPhone = order.customerPhone || order.customerDetails?.phone;
        }
        if (!finalMessage) {
          const tenant = await Tenant.findById(tenantId).lean();
          finalMessage = formatOrderReceipt(order, tenant);
        }
      }
    }

    if (!targetPhone) {
      return res.status(400).json({
        success: false,
        error: 'Customer phone number is required to send bill.'
      });
    }

    if (!finalMessage) {
      return res.status(400).json({
        success: false,
        error: 'Receipt text or valid orderId is required.'
      });
    }

    const result = await sendWhatsAppMessage(tenantId, {
      phone: targetPhone,
      message: finalMessage
    });

    if (!result.success) {
      return res.status(result.notConnected ? 503 : 400).json(result);
    }

    res.json({
      success: true,
      message: `Bill dispatched to +${result.phone} via WhatsApp.`,
      phone: result.phone,
      messageId: result.messageId
    });
  } catch (err) {
    console.error('WhatsApp send-bill error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

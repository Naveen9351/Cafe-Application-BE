const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');
const Tenant = require('../models/Tenant');
const Customer = require('../models/Customer');
const auth = require('../middleware/auth');
const deductStockForOrder = require('../utils/stockDeductor');
const { generateMeaningfulOrderNumber } = require('../utils/orderNumberGenerator');
const {
  getRazorpayInstance,
  getPlatformCommissionPercent,
  createLinkedAccount,
  fetchLinkedAccount,
  createOrderWithRoute,
  verifyPaymentSignature,
  verifyWebhookSignature,
  processRefund,
  processTransfer
} = require('../utils/razorpay');

/**
 * Helper to emit socket events safely
 */
function emitTenantEvent(tenantId, event, data) {
  try {
    if (global.io && tenantId) {
      global.io.to(tenantId.toString()).emit(event, data);
    }
  } catch (err) {
    console.warn(`Socket emission error for ${event}:`, err.message);
  }
}

// =============================================================================
// 1. GET PAYMENT GATEWAY CONFIG (Public)
// Returns public keyId and operational status
// =============================================================================
router.get('/config', (req, res) => {
  const keyId = process.env.RAZORPAY_KEY_ID || '';
  const isConfigured = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
  const platformCommission = getPlatformCommissionPercent();

  res.json({
    keyId,
    currency: 'INR',
    isConfigured,
    platformCommissionPercent: platformCommission
  });
});

// =============================================================================
// 2. REGISTER / CONNECT RAZORPAY LINKED ACCOUNT (Auth required)
// Supports creating a new Route account OR linking an existing account ID
// =============================================================================
router.post('/account/register', auth, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId || req.body.tenantId;
    if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
      return res.status(400).json({ error: 'Valid Tenant ID is required' });
    }

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant café not found' });
    }

    const {
      accountId, // optional existing acc_xxxxxxxxx
      email,
      phone,
      businessName,
      legalName,
      businessType,
      contactName,
      accountNumber,
      ifscCode,
      street,
      city,
      state,
      postalCode,
      commissionPercent
    } = req.body;

    let finalAccountId = accountId ? accountId.trim() : null;
    let accountStatus = 'created';
    let rawDetails = null;

    // Case A: User connects an existing Razorpay Linked Account ID (e.g. acc_K0xxxxxxxxx)
    if (finalAccountId) {
      if (!finalAccountId.startsWith('acc_')) {
        return res.status(400).json({ error: 'Invalid Razorpay Account ID format. It should start with "acc_"' });
      }

      // Try fetching live account info from Razorpay if credentials exist
      try {
        const liveAcc = await fetchLinkedAccount(finalAccountId);
        if (liveAcc) {
          rawDetails = liveAcc;
          accountStatus = liveAcc.status === 'activated' ? 'activated' : (liveAcc.status || 'created');
        }
      } catch (fetchErr) {
        console.warn('Could not verify account with Razorpay API (will still link):', fetchErr.message);
        accountStatus = 'under_review';
      }
    } else {
      // Case B: Create new Route Linked Account via Razorpay Route API
      if (!email || !phone || !businessName) {
        return res.status(400).json({ error: 'Email, phone, and business name are required to register a payment account' });
      }

      try {
        const newAccount = await createLinkedAccount({
          email,
          phone,
          businessName,
          legalName: legalName || businessName,
          businessType: businessType || 'individual',
          contactName: contactName || tenant.name,
          accountNumber,
          ifscCode,
          street,
          city,
          state,
          postalCode,
          notes: {
            tenantId: tenant._id.toString(),
            tenantName: tenant.name
          }
        });

        finalAccountId = newAccount.id;
        accountStatus = newAccount.status === 'activated' ? 'activated' : (newAccount.status || 'created');
        rawDetails = newAccount;
      } catch (rzpErr) {
        console.error('Razorpay Route account creation error:', rzpErr);
        const errMsg = rzpErr.error?.description || rzpErr.message || 'Failed to create linked account on Razorpay';
        return res.status(400).json({ error: errMsg, details: rzpErr.error || null });
      }
    }

    // Persist in Tenant model
    tenant.razorpay = {
      accountId: finalAccountId,
      accountStatus: accountStatus,
      businessName: businessName || tenant.name,
      legalName: legalName || businessName || tenant.name,
      email: email || tenant.email,
      phone: phone || tenant.phone,
      accountType: 'standard',
      bankAccountNumber: accountNumber ? String(accountNumber).slice(-4) : (tenant.razorpay?.bankAccountNumber || ''),
      bankIfsc: ifscCode ? String(ifscCode).toUpperCase() : (tenant.razorpay?.bankIfsc || ''),
      commissionPercent: commissionPercent !== undefined ? Number(commissionPercent) : (tenant.razorpay?.commissionPercent || 0),
      isLive: accountStatus === 'activated',
      linkedAt: new Date(),
      rawAccountDetails: rawDetails
    };

    tenant.markModified('razorpay');
    await tenant.save();

    res.json({
      success: true,
      message: 'Razorpay Route linked account registered successfully',
      razorpay: tenant.razorpay
    });
  } catch (err) {
    console.error('Register payment account error:', err);
    res.status(500).json({ error: err.message || 'Failed to register payment account' });
  }
});

// =============================================================================
// 3. CHECK LINKED ACCOUNT VERIFICATION STATUS (Auth required)
// Fetches real-time status from Razorpay Route
// =============================================================================
router.get('/account/status', auth, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId || req.query.tenantId;
    if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
      return res.status(400).json({ error: 'Valid Tenant ID is required' });
    }

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant café not found' });
    }

    if (!tenant.razorpay?.accountId) {
      return res.json({
        isLinked: false,
        accountStatus: 'unlinked',
        message: 'No Razorpay account linked yet'
      });
    }

    let liveAccount = null;
    let liveStatus = tenant.razorpay.accountStatus || 'created';

    try {
      liveAccount = await fetchLinkedAccount(tenant.razorpay.accountId);
      if (liveAccount) {
        liveStatus = liveAccount.status === 'activated' ? 'activated' : (liveAccount.status || 'under_review');
        tenant.razorpay.accountStatus = liveStatus;
        tenant.razorpay.isLive = liveStatus === 'activated';
        tenant.razorpay.rawAccountDetails = liveAccount;
        tenant.markModified('razorpay');
        await tenant.save();
      }
    } catch (apiErr) {
      console.warn('Could not fetch live status from Razorpay (using saved):', apiErr.message);
    }

    res.json({
      isLinked: true,
      accountId: tenant.razorpay.accountId,
      accountStatus: liveStatus,
      businessName: tenant.razorpay.businessName,
      email: tenant.razorpay.email,
      phone: tenant.razorpay.phone,
      bankAccountNumber: tenant.razorpay.bankAccountNumber,
      bankIfsc: tenant.razorpay.bankIfsc,
      commissionPercent: tenant.razorpay.commissionPercent || 0,
      isLive: liveStatus === 'activated',
      linkedAt: tenant.razorpay.linkedAt,
      liveData: liveAccount
    });
  } catch (err) {
    console.error('Account status check error:', err);
    res.status(500).json({ error: err.message || 'Failed to check account status' });
  }
});

// =============================================================================
// 4. UNLINK RAZORPAY ACCOUNT (Auth required)
// =============================================================================
router.post('/account/unlink', auth, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.tenantId || req.body.tenantId;
    if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
      return res.status(400).json({ error: 'Valid Tenant ID is required' });
    }

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    tenant.razorpay = {
      accountId: null,
      accountStatus: 'unlinked',
      isLive: false,
      businessName: '',
      email: '',
      phone: '',
      bankAccountNumber: '',
      bankIfsc: '',
      commissionPercent: 0
    };
    tenant.markModified('razorpay');
    await tenant.save();

    res.json({ success: true, message: 'Payment account unlinked successfully' });
  } catch (err) {
    console.error('Unlink account error:', err);
    res.status(500).json({ error: 'Failed to unlink account' });
  }
});

// =============================================================================
// 5. CREATE PAYMENT ORDER (Public / Customer Cart Checkout)
// Creates Razorpay Order with Route transfers automatically attached!
// =============================================================================
router.post('/create-order', async (req, res) => {
  try {
    const { items, tableNumber, tenantId, customerDetails, notes } = req.body;

    if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
      return res.status(400).json({ error: 'Valid Tenant ID is required' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array is required' });
    }

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant café not found' });
    }

    // 1. Calculate and strictly verify prices server-side (Never trust client prices!)
    const cleanItemId = (raw) => {
      if (!raw) return '';
      const str = String(raw).trim();
      return str.includes('_') ? str.split('_')[0] : str;
    };

    const itemIds = items
      .map(i => cleanItemId(i.id || i.itemId || i.item || i._id))
      .filter(id => id && mongoose.Types.ObjectId.isValid(id));

    let dbItems = [];
    if (itemIds.length > 0) {
      dbItems = await MenuItem.find({
        _id: { $in: itemIds },
        tenantId: tenantId
      });
    }

    if (dbItems.length === 0) {
      const clientNames = items
        .map(i => (i.name || '').replace(/\s*\([^)]*\)/, '').trim())
        .filter(Boolean);
      if (clientNames.length > 0) {
        dbItems = await MenuItem.find({
          tenantId: tenantId,
          name: { $in: clientNames }
        });
      }
    }

    let subTotal = 0;
    const orderItems = [];

    for (const clientItem of items) {
      const cId = cleanItemId(clientItem.id || clientItem.itemId || clientItem.item || clientItem._id || '');
      const clientName = (clientItem.name || '').replace(/\s*\([^)]*\)/, '').trim().toLowerCase();

      let dbItem = dbItems.find(i => i._id.toString() === cId);
      if (!dbItem && clientName) {
        dbItem = dbItems.find(i => (i.name || '').trim().toLowerCase() === clientName);
      }

      if (dbItem) {
        const quantity = Number(clientItem.quantity) || 1;
        let basePrice = dbItem.price;

        // Apply item discount if set
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
          basePrice = clientItem.variant.price || basePrice;
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
          addons: selectedAddons,
          specialNotes: clientItem.specialNotes || clientItem.notes || '',
          itemStatus: 'pending',
          isPaid: false
        });
      } else if (clientItem.name && clientItem.price !== undefined) {
        // Fallback open item
        const quantity = Number(clientItem.quantity) || 1;
        const basePrice = Math.max(0, Number(clientItem.price) || 0);
        subTotal += basePrice * quantity;

        orderItems.push({
          name: String(clientItem.name).trim(),
          quantity: quantity,
          price: basePrice,
          variant: null,
          addons: [],
          specialNotes: clientItem.specialNotes || clientItem.notes || '',
          itemStatus: 'pending',
          isPaid: false
        });
      }
    }

    if (orderItems.length === 0 || subTotal <= 0) {
      return res.status(400).json({ error: 'Cart is empty or item prices are zero' });
    }

    const total = Math.round(subTotal * 100) / 100;
    const pointsEarned = Math.round(subTotal * 0.05);

    // 2. Generate unique order number
    const effectiveCustName = customerDetails?.name || 'Guest';
    const baseOrderNumber = generateMeaningfulOrderNumber({
      customerName: effectiveCustName,
      date: new Date()
    });

    let uniqueOrderNumber = baseOrderNumber;
    let collisionIndex = 1;
    while (await Order.exists({ tenantId, orderNumber: uniqueOrderNumber })) {
      uniqueOrderNumber = `${baseOrderNumber}-${collisionIndex}`;
      collisionIndex++;
    }

    // 3. Razorpay Route: Determine linked account and commission
    const tenantAccountId = tenant.razorpay?.accountId || null;
    const tenantCommission = tenant.razorpay?.commissionPercent;

    let routeResult = null;
    try {
      routeResult = await createOrderWithRoute({
        amountInRupees: total,
        currency: 'INR',
        receipt: `rcpt_${uniqueOrderNumber}`,
        notes: {
          tenantId: tenant._id.toString(),
          tenantName: tenant.name,
          orderNumber: uniqueOrderNumber,
          tableNumber: tableNumber || 'Online Order'
        },
        tenantAccountId,
        commissionPercent: tenantCommission
      });
    } catch (rzpErr) {
      console.error('Error creating Razorpay Route order:', rzpErr);
      const errMsg = rzpErr.error?.description || rzpErr.message || 'Razorpay order creation failed';
      return res.status(400).json({ error: errMsg });
    }

    const { rzpOrder, platformFeePaise, vendorAmountPaise, commissionPercent } = routeResult;

    // 4. Save Order in MongoDB with pending status
    const newOrder = new Order({
      tenantId,
      orderNumber: uniqueOrderNumber,
      tableNumber: tableNumber || 'Online Order',
      items: orderItems,
      subTotal,
      taxAmount: 0,
      total,
      paidAmount: 0,
      settledAmount: 0,
      paymentMethod: 'Razorpay',
      orderType: tableNumber && tableNumber !== 'Online Order' ? 'dine_in' : 'online',
      customerDetails: customerDetails || {},
      notes: notes || '',
      status: 'pending',
      paymentStatus: 'pending',
      loyaltyPointsEarned: pointsEarned,
      razorpay: {
        orderId: rzpOrder.id,
        status: 'created',
        amount: total,
        currency: 'INR',
        platformCommissionPercent: commissionPercent,
        platformFee: platformFeePaise / 100,
        vendorAmount: vendorAmountPaise / 100,
        vendorAccountId: tenantAccountId || null
      }
    });

    await newOrder.save();

    res.json({
      success: true,
      keyId: process.env.RAZORPAY_KEY_ID,
      orderId: rzpOrder.id,
      amount: rzpOrder.amount, // in paise
      currency: rzpOrder.currency,
      dbOrderId: newOrder._id,
      orderNumber: newOrder.orderNumber,
      cafeName: tenant.name,
      platformFee: platformFeePaise / 100,
      vendorAmount: vendorAmountPaise / 100,
      isRouted: Boolean(tenantAccountId)
    });
  } catch (err) {
    console.error('Create payment order error:', err);
    res.status(500).json({ error: err.message || 'Server error creating payment order' });
  }
});

// =============================================================================
// 6. VERIFY PAYMENT SIGNATURE (Public / Customer Cart Checkout)
// Strictly verifies HMAC SHA-256 signature and captures order
// =============================================================================
router.post('/verify', async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      dbOrderId
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment signature verification parameters' });
    }

    // 1. Verify HMAC SHA-256 signature
    const isValid = verifyPaymentSignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature
    });

    if (!isValid) {
      // Mark as failed in DB if order found
      if (dbOrderId && mongoose.Types.ObjectId.isValid(dbOrderId)) {
        await Order.findByIdAndUpdate(dbOrderId, {
          paymentStatus: 'failed',
          'razorpay.status': 'failed',
          'razorpay.errorDescription': 'Invalid payment signature'
        });
      }
      return res.status(400).json({ success: false, error: 'Invalid payment signature. Verification failed.' });
    }

    // 2. Find MongoDB order by dbOrderId or razorpay.orderId
    let order = null;
    if (dbOrderId && mongoose.Types.ObjectId.isValid(dbOrderId)) {
      order = await Order.findById(dbOrderId);
    }
    if (!order) {
      order = await Order.findOne({ 'razorpay.orderId': razorpay_order_id });
    }

    if (!order) {
      return res.status(404).json({ error: 'Order not found in database' });
    }

    // Idempotency: If already paid, return success immediately
    if (order.paymentStatus === 'paid') {
      return res.json({
        success: true,
        message: 'Order already marked as paid',
        order
      });
    }

    // 3. Update Order status to paid & confirmed
    order.paymentStatus = 'paid';
    order.status = 'confirmed';
    order.paidAmount = order.total;
    order.settledAmount = order.total;
    order.paymentMethod = 'Razorpay';

    order.items = order.items.map(item => ({
      ...item.toObject(),
      isPaid: true,
      paidAt: new Date(),
      itemPaymentMethod: 'Razorpay'
    }));

    order.razorpay = {
      ...order.razorpay,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
      status: 'captured',
      capturedAt: new Date()
    };

    await order.save();

    // 4. Update Customer loyalty points & CRM
    if (order.customerDetails?.phone) {
      try {
        const cleanPhone = String(order.customerDetails.phone).replace(/\D/g, '');
        let customer = await Customer.findOne({ tenantId: order.tenantId, phone: cleanPhone });
        if (!customer) {
          customer = new Customer({
            tenantId: order.tenantId,
            name: order.customerDetails.name || 'Walk-in Customer',
            phone: cleanPhone,
            loyaltyPoints: order.loyaltyPointsEarned || 0,
            totalSpent: order.total,
            visitCount: 1,
            isPhoneVerified: Boolean(order.customerDetails.isPhoneVerified),
            firstVisit: new Date(),
            lastVisit: new Date()
          });
        } else {
          customer.loyaltyPoints += (order.loyaltyPointsEarned || 0);
          customer.totalSpent += order.total;
          customer.visitCount += 1;
          customer.lastVisit = new Date();
        }
        await customer.save();
      } catch (crmErr) {
        console.warn('Customer loyalty update error:', crmErr.message);
      }
    }

    // 5. Deduct inventory stock asynchronously
    setImmediate(() => deductStockForOrder(order));

    // 6. Emit real-time updates to KDS, POS & Waiter terminals
    emitTenantEvent(order.tenantId, 'newOrder', order);
    emitTenantEvent(order.tenantId, 'orderUpdate', order);
    emitTenantEvent(order.tenantId, 'ordersRefresh', {});

    res.json({
      success: true,
      message: 'Payment verified and order confirmed successfully',
      order
    });
  } catch (err) {
    console.error('Payment verification error:', err);
    res.status(500).json({ error: err.message || 'Payment verification failed' });
  }
});

// =============================================================================
// 7. VENDOR MANUAL / ON-DEMAND TRANSFER (Auth required)
// =============================================================================
router.post('/transfer', auth, async (req, res) => {
  try {
    const { orderId, paymentId, accountId, amount } = req.body;

    let targetPaymentId = paymentId;
    let targetAccountId = accountId;
    let targetAmount = amount;
    let order = null;

    if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
      order = await Order.findById(orderId);
      if (order) {
        targetPaymentId = targetPaymentId || order.razorpay?.paymentId;
        targetAccountId = targetAccountId || order.razorpay?.vendorAccountId;
        targetAmount = targetAmount || order.razorpay?.vendorAmount || order.total;
      }
    }

    if (!targetPaymentId || !targetAccountId || !targetAmount) {
      return res.status(400).json({ error: 'paymentId, accountId, and amount are required for vendor transfer' });
    }

    const transferResult = await processTransfer({
      paymentId: targetPaymentId,
      accountId: targetAccountId,
      amountInRupees: targetAmount,
      notes: { orderId: order?._id?.toString() || '' }
    });

    if (order && transferResult.items && transferResult.items[0]) {
      order.razorpay.transferId = transferResult.items[0].id;
      order.markModified('razorpay');
      await order.save();
    }

    res.json({
      success: true,
      message: 'Vendor transfer processed successfully',
      transfer: transferResult
    });
  } catch (err) {
    console.error('Vendor transfer error:', err);
    res.status(500).json({ error: err.message || 'Vendor transfer failed' });
  }
});

// =============================================================================
// 8. REFUND PAYMENT (Auth required)
// Reverses transfer and refunds customer
// =============================================================================
router.post('/refund', auth, async (req, res) => {
  try {
    const { orderId, amount, reason } = req.body;

    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ error: 'Valid Order ID is required' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const paymentId = order.razorpay?.paymentId;
    if (!paymentId) {
      return res.status(400).json({ error: 'This order does not have an associated Razorpay payment ID to refund.' });
    }

    const refundAmount = amount !== undefined ? Number(amount) : order.total;

    const refund = await processRefund({
      paymentId,
      amountInRupees: refundAmount,
      reverseAll: 1, // Automatically reverse Route transfer from linked account
      notes: {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        reason: reason || 'Customer requested refund'
      }
    });

    // Update order status
    order.paymentStatus = 'refunded';
    order.status = 'cancelled';
    order.razorpay.refundId = refund.id;
    order.razorpay.refundAmount = refundAmount;
    order.razorpay.refundStatus = refund.status || 'processed';
    order.markModified('razorpay');
    await order.save();

    emitTenantEvent(order.tenantId, 'orderUpdate', order);
    emitTenantEvent(order.tenantId, 'ordersRefresh', {});

    res.json({
      success: true,
      message: 'Refund and transfer reversal processed successfully',
      refund,
      order
    });
  } catch (err) {
    console.error('Refund processing error:', err);
    res.status(500).json({ error: err.message || 'Refund processing failed' });
  }
});

// =============================================================================
// 9. RAZORPAY WEBHOOK HANDLER (Public Webhook)
// Signature verified using raw buffer against RAZORPAY_WEBHOOK_SECRET
// =============================================================================
router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.rawBody || JSON.stringify(req.body);

    // Verify webhook signature
    const isValid = verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      console.warn('⚠️ Razorpay webhook signature verification failed.');
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const event = req.body.event;
    const payload = req.body.payload;

    console.log(`🔔 Razorpay Webhook Event: ${event}`);

    // Handle payment.captured or order.paid
    if (event === 'payment.captured' || event === 'order.paid') {
      const payment = payload?.payment?.entity;
      const rzpOrderId = payment?.order_id || payload?.order?.entity?.id;
      const paymentId = payment?.id;

      if (rzpOrderId) {
        const order = await Order.findOne({ 'razorpay.orderId': rzpOrderId });
        if (order && order.paymentStatus !== 'paid') {
          order.paymentStatus = 'paid';
          order.status = 'confirmed';
          order.paidAmount = order.total;
          order.settledAmount = order.total;
          order.paymentMethod = 'Razorpay';
          order.razorpay.status = 'captured';
          order.razorpay.capturedAt = new Date();
          if (paymentId) order.razorpay.paymentId = paymentId;

          order.items = order.items.map(i => ({ ...i.toObject(), isPaid: true, paidAt: new Date() }));
          await order.save();

          setImmediate(() => deductStockForOrder(order));
          emitTenantEvent(order.tenantId, 'orderUpdate', order);
          emitTenantEvent(order.tenantId, 'ordersRefresh', {});
        }
      }
    } else if (event === 'payment.failed') {
      const payment = payload?.payment?.entity;
      const rzpOrderId = payment?.order_id;
      if (rzpOrderId) {
        await Order.findOneAndUpdate(
          { 'razorpay.orderId': rzpOrderId, paymentStatus: { $ne: 'paid' } },
          {
            paymentStatus: 'failed',
            'razorpay.status': 'failed',
            'razorpay.errorDescription': payment?.error_description || 'Payment failed'
          }
        );
      }
    } else if (event === 'transfer.processed') {
      const transfer = payload?.transfer?.entity;
      if (transfer?.source && transfer?.id) {
        await Order.findOneAndUpdate(
          { 'razorpay.paymentId': transfer.source },
          { 'razorpay.transferId': transfer.id }
        );
      }
    } else if (event === 'refund.processed') {
      const refund = payload?.refund?.entity;
      const paymentId = refund?.payment_id;
      if (paymentId) {
        await Order.findOneAndUpdate(
          { 'razorpay.paymentId': paymentId },
          {
            paymentStatus: 'refunded',
            status: 'cancelled',
            'razorpay.refundId': refund.id,
            'razorpay.refundStatus': 'processed'
          }
        );
      }
    }

    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Webhook processing error' });
  }
});

module.exports = router;

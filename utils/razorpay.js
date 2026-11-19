const Razorpay = require('razorpay');
const crypto = require('crypto');

let razorpayInstance = null;

/**
 * Get or initialize Razorpay client instance
 */
function getRazorpayInstance() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return null;
  }

  if (!razorpayInstance || razorpayInstance.key_id !== keyId) {
    razorpayInstance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret
    });
  }

  return razorpayInstance;
}

/**
 * Get configured platform commission percentage
 * @param {number|null} tenantOverride
 * @returns {number} commission percentage (0 - 100)
 */
function getPlatformCommissionPercent(tenantOverride) {
  if (tenantOverride !== undefined && tenantOverride !== null && !isNaN(Number(tenantOverride))) {
    const override = Number(tenantOverride);
    if (override >= 0 && override <= 100) {
      return override;
    }
  }
  const envVal = Number(process.env.PLATFORM_COMMISSION_PERCENT || process.env.RASTRORATO_COMMISSION_PERCENT || 0);
  return isNaN(envVal) ? 0 : Math.max(0, Math.min(100, envVal));
}

/**
 * Create a Razorpay Route Linked Account for a café
 */
async function createLinkedAccount({
  email,
  phone,
  businessName,
  legalName,
  businessType = 'individual',
  contactName,
  accountNumber,
  ifscCode,
  street,
  city,
  state,
  postalCode,
  notes = {}
}) {
  const rzp = getRazorpayInstance();
  if (!rzp) {
    throw new Error('Razorpay API keys (RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET) are not configured.');
  }

  const payload = {
    email: email.trim(),
    phone: String(phone).replace(/\D/g, '').slice(-10),
    type: 'standard',
    legal_business_name: (legalName || businessName || 'Cafe Owner').trim(),
    business_type: businessType,
    contact_name: (contactName || businessName || 'Cafe Manager').trim(),
    profile: {
      category: 'food_and_beverage',
      subcategory: 'restaurant',
      addresses: {
        registered: {
          street1: (street || 'Commercial Street').trim(),
          city: (city || 'New Delhi').trim(),
          state: (state || 'Delhi').trim(),
          postal_code: (postalCode || '110001').trim(),
          country: 'IN'
        }
      }
    },
    notes: {
      platform: 'RASTRORATO_DINEVIQ',
      ...notes
    }
  };

  // If bank details provided, attach legal_info / bank info if requested
  if (accountNumber && ifscCode) {
    payload.notes.bank_account_last4 = String(accountNumber).slice(-4);
    payload.notes.bank_ifsc = String(ifscCode).toUpperCase();
  }

  const response = await rzp.accounts.create(payload);
  return response;
}

/**
 * Fetch linked account details and verification status from Razorpay Route
 */
async function fetchLinkedAccount(accountId) {
  const rzp = getRazorpayInstance();
  if (!rzp) {
    throw new Error('Razorpay API keys are not configured.');
  }
  if (!accountId) {
    throw new Error('Account ID is required to fetch status.');
  }

  const account = await rzp.accounts.fetch(accountId);
  return account;
}

/**
 * Create a Razorpay Order with optional Route transfers to café linked account
 */
async function createOrderWithRoute({
  amountInRupees,
  currency = 'INR',
  receipt,
  notes = {},
  tenantAccountId = null,
  commissionPercent = null
}) {
  const rzp = getRazorpayInstance();
  if (!rzp) {
    throw new Error('Razorpay API keys are not configured.');
  }

  const totalPaise = Math.round(Number(amountInRupees) * 100);
  if (totalPaise <= 0) {
    throw new Error('Order amount must be greater than zero.');
  }

  const activeCommissionPercent = getPlatformCommissionPercent(commissionPercent);
  const platformFeePaise = Math.round(totalPaise * (activeCommissionPercent / 100));
  const vendorAmountPaise = Math.max(0, totalPaise - platformFeePaise);

  const orderOptions = {
    amount: totalPaise,
    currency,
    receipt: receipt || `rcpt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    notes: {
      ...notes,
      platformFeePaise: String(platformFeePaise),
      vendorAmountPaise: String(vendorAmountPaise),
      commissionPercent: String(activeCommissionPercent)
    }
  };

  let rzpOrder;
  let actuallyRouted = false;

  // If a valid linked account exists, try creating with Route transfers directly
  if (tenantAccountId && typeof tenantAccountId === 'string' && tenantAccountId.startsWith('acc_')) {
    orderOptions.transfers = [
      {
        account: tenantAccountId,
        amount: vendorAmountPaise,
        currency,
        notes: {
          tenantId: notes.tenantId || '',
          orderNumber: notes.orderNumber || ''
        },
        linked_account_notes: ['tenantId', 'orderNumber'],
        on_hold: 0 // Automatically settle to cafe linked account
      }
    ];

    try {
      rzpOrder = await rzp.orders.create(orderOptions);
      actuallyRouted = true;
    } catch (routeErr) {
      console.warn('⚠️ Razorpay Route inline transfer unsupported or Route not enabled on master account:', routeErr.error?.description || routeErr.message);
      // Fallback: Create standard payment order so customer checkout never gets blocked
      delete orderOptions.transfers;
      orderOptions.notes.route_transfer_pending = 'true';
      orderOptions.notes.target_account = tenantAccountId;
      rzpOrder = await rzp.orders.create(orderOptions);
    }
  } else {
    rzpOrder = await rzp.orders.create(orderOptions);
  }

  return {
    rzpOrder,
    totalPaise,
    platformFeePaise,
    vendorAmountPaise,
    commissionPercent: activeCommissionPercent,
    routedToAccount: actuallyRouted ? tenantAccountId : null,
    isRouteDeferred: Boolean(tenantAccountId && !actuallyRouted)
  };
}

/**
 * Verify Razorpay payment signature
 */
function verifyPaymentSignature({ orderId, paymentId, signature }) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    throw new Error('Razorpay Key Secret is not configured.');
  }

  if (!orderId || !paymentId || !signature) {
    return false;
  }

  const generatedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(generatedSignature, 'utf-8'),
    Buffer.from(signature, 'utf-8')
  );
}

/**
 * Verify Razorpay Webhook signature
 */
function verifyWebhookSignature(rawBody, signature, webhookSecret) {
  const secret = webhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('⚠️ RAZORPAY_WEBHOOK_SECRET is not set. Webhook verification skipped in dev.');
    return true; // Allow in local dev if secret unset
  }

  if (!rawBody || !signature) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'utf-8'),
      Buffer.from(signature, 'utf-8')
    );
  } catch (err) {
    return false;
  }
}

/**
 * Refund a payment and reverse Route transfer
 */
async function processRefund({ paymentId, amountInRupees, reverseAll = 1, notes = {} }) {
  const rzp = getRazorpayInstance();
  if (!rzp) {
    throw new Error('Razorpay API keys are not configured.');
  }

  const refundPayload = {
    reverse_all: reverseAll ? 1 : 0,
    notes: {
      platform: 'RASTRORATO_DINEVIQ',
      ...notes
    }
  };

  if (amountInRupees !== undefined && amountInRupees !== null) {
    refundPayload.amount = Math.round(Number(amountInRupees) * 100);
  }

  const refund = await rzp.payments.refund(paymentId, refundPayload);
  return refund;
}

/**
 * Perform manual / on-demand vendor transfer for captured payment
 */
async function processTransfer({ paymentId, accountId, amountInRupees, notes = {} }) {
  const rzp = getRazorpayInstance();
  if (!rzp) {
    throw new Error('Razorpay API keys are not configured.');
  }

  const amountPaise = Math.round(Number(amountInRupees) * 100);
  const transfer = await rzp.payments.transfer(paymentId, {
    transfers: [
      {
        account: accountId,
        amount: amountPaise,
        currency: 'INR',
        notes: {
          platform: 'RASTRORATO_DINEVIQ',
          ...notes
        }
      }
    ]
  });

  return transfer;
}

module.exports = {
  getRazorpayInstance,
  getPlatformCommissionPercent,
  createLinkedAccount,
  fetchLinkedAccount,
  createOrderWithRoute,
  verifyPaymentSignature,
  verifyWebhookSignature,
  processRefund,
  processTransfer
};

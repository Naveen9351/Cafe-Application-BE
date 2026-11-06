const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();
const KhataRecord = require('../models/KhataRecord');
const Order = require('../models/Order');
const User = require('../models/User');
const auth = require('../middleware/auth');

/**
 * Helper to ensure tenantId is resolved
 */
const getTenantId = async (req) => {
    let tenantId = req.user?.tenantId?._id || req.user?.tenantId || req.tenantId || req.body?.tenantId || req.query?.tenantId;
    if (!tenantId && req.user?.id) {
        try {
            const user = await User.findById(req.user.id);
            if (user && user.tenantId) {
                tenantId = user.tenantId;
            }
        } catch (e) {
            console.error('Error resolving tenantId:', e);
        }
    }
    return tenantId;
};

/**
 * @route   GET /api/khata
 * @desc    Get all khata (borrow) records for the authenticated tenant
 * @access  Private
 */
router.get('/', auth, async (req, res) => {
    try {
        const tenantId = await getTenantId(req);
        let query = {};
        if (tenantId) {
            query = {
                $or: [
                    { tenantId: tenantId },
                    { tenantId: String(tenantId) }
                ]
            };
        }
        const records = await KhataRecord.find(query).sort({ createdAt: -1 });

        const totalOutstanding = records
            .filter(r => r.status !== 'settled')
            .reduce((sum, r) => sum + (Number(r.borrowAmount) || 0), 0);

        const totalRecovered = records
            .reduce((sum, r) => sum + (Number(r.paidAmount) || 0), 0);

        const totalCredit = records
            .reduce((sum, r) => sum + (Number(r.totalBill) || (Number(r.borrowAmount || 0) + Number(r.paidAmount || 0))), 0);

        res.json({
            success: true,
            records,
            totalOutstanding,
            totalRecovered,
            totalCredit,
            count: records.length
        });
    } catch (err) {
        console.error('Fetch khata records error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch khata records' });
    }
});

/**
 * @route   POST /api/khata
 * @desc    Create a new borrow record (called from POS settlement or standalone)
 * @access  Private
 */
router.post('/', auth, async (req, res) => {
    try {
        const tenantId = await getTenantId(req);
        const { orderId, orderNumber, customerName, customerPhone, totalBill, paidAmount, borrowAmount, notes, items } = req.body;

        const effectiveCustomerName = (customerName && String(customerName).trim()) ? String(customerName).trim() : 'Walk-in Guest';
        let cleanPhone = String(customerPhone || '').replace(/[^0-9]/g, '');
        if (!cleanPhone) cleanPhone = 'N/A';

        const parsedBill = Math.max(0, Number(totalBill) || (Number(paidAmount || 0) + Number(borrowAmount || 0)));
        const parsedPaid = Math.min(parsedBill, Math.max(0, Number(paidAmount) || 0));
        const parsedBorrow = Math.max(0, parsedBill - parsedPaid);

        const newRecord = new KhataRecord({
            tenantId,
            orderId: orderId || null,
            orderNumber: orderNumber || '',
            customerName: effectiveCustomerName,
            customerPhone: cleanPhone,
            totalBill: parsedBill,
            paidAmount: parsedPaid,
            borrowAmount: parsedBorrow,
            items: Array.isArray(items) ? items : [],
            notes: notes || '',
            status: parsedBorrow <= 0 ? 'settled' : (parsedPaid > 0 ? 'partially_settled' : 'pending')
        });

        await newRecord.save();
        res.status(201).json({
            success: true,
            message: `Khata record created for ${effectiveCustomerName} (₹${parsedBorrow} pending)`,
            record: newRecord
        });
    } catch (err) {
        console.error('Create khata record error:', err);
        res.status(500).json({ success: false, error: 'Failed to create khata record: ' + err.message });
    }
});

/**
 * @route   PUT /api/khata/:id/settle
 * @desc    Record a debt payment from customer to settle borrow
 * @access  Private
 */
router.put('/:id/settle', auth, async (req, res) => {
    try {
        const tenantId = await getTenantId(req);
        const { amountReceived, amount, paymentMethod, notes } = req.body;

        const filter = { _id: req.params.id };
        if (tenantId) filter.tenantId = tenantId;

        const record = await KhataRecord.findOne(filter);
        if (!record) {
            return res.status(404).json({ success: false, error: 'Khata record not found' });
        }

        const effectiveAmount = amountReceived !== undefined ? amountReceived : amount;
        const received = Math.min(record.borrowAmount, Math.max(0, Number(effectiveAmount) || record.borrowAmount));
        record.paidAmount = (record.paidAmount || 0) + received;
        record.borrowAmount = Math.max(0, (record.borrowAmount || 0) - received);

        if (record.borrowAmount <= 0) {
            record.borrowAmount = 0;
            record.status = 'settled';
        } else {
            record.status = 'partially_settled';
        }

        const cleanMethod = (paymentMethod || 'cash').toLowerCase();
        const validMethod = ['cash', 'upi', 'card'].includes(cleanMethod) ? cleanMethod : 'cash';

        record.settlementHistory.push({
            amount: received,
            paymentMethod: validMethod,
            settledAt: new Date(),
            settledBy: req.user.name || req.user.email || 'Staff',
            notes: notes || ''
        });

        record.updatedAt = new Date();
        await record.save();

        res.json({
            success: true,
            message: `Payment of ₹${received} recorded for ${record.customerName}. ${record.borrowAmount > 0 ? `Remaining: ₹${record.borrowAmount}` : 'Account fully settled!'}`,
            record
        });
    } catch (err) {
        console.error('Settle khata error:', err);
        res.status(500).json({ success: false, error: 'Failed to settle khata: ' + err.message });
    }
});

/**
 * @route   DELETE /api/khata/:id
 * @desc    Delete a khata record
 * @access  Private
 */
router.delete('/:id', auth, async (req, res) => {
    try {
        const tenantId = await getTenantId(req);
        const filter = { _id: req.params.id };
        if (tenantId) filter.tenantId = tenantId;

        const deleted = await KhataRecord.findOneAndDelete(filter);
        if (!deleted) return res.status(404).json({ success: false, error: 'Khata record not found' });

        res.json({ success: true, message: 'Khata record deleted' });
    } catch (err) {
        console.error('Delete khata error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route   GET /api/khata/customers
 * @desc    Get aggregated khata accounts by customer
 */
router.get('/customers', auth, async (req, res) => {
    try {
        const tenantId = await getTenantId(req);
        let match = {};
        if (tenantId) {
            try {
                const objId = new mongoose.Types.ObjectId(tenantId);
                match = { $or: [{ tenantId: objId }, { tenantId: String(tenantId) }] };
            } catch (e) {
                match = { tenantId };
            }
        }

        const records = await KhataRecord.find(match).sort({ createdAt: -1 });

        const customerMap = new Map();
        records.forEach(r => {
            const phone = String(r.customerPhone || '').trim();
            const key = (phone && phone !== 'N/A') ? phone : `NAME_${String(r.customerName || 'Guest').toLowerCase().trim()}`;
            if (!customerMap.has(key)) {
                customerMap.set(key, {
                    customerName: r.customerName || 'Walk-in Guest',
                    customerPhone: phone || 'N/A',
                    totalBill: 0,
                    paidAmount: 0,
                    outstandingBalance: 0,
                    recordsCount: 0,
                    lastTransactionDate: r.createdAt,
                    records: []
                });
            }
            const c = customerMap.get(key);
            c.totalBill += Number(r.totalBill) || 0;
            c.paidAmount += Number(r.paidAmount) || 0;
            if (r.status !== 'settled') {
                c.outstandingBalance += Number(r.borrowAmount) || 0;
            }
            c.recordsCount += 1;
            c.records.push(r);
        });

        const customers = Array.from(customerMap.values()).sort((a, b) => b.outstandingBalance - a.outstandingBalance);

        res.json({ success: true, customers });
    } catch (err) {
        console.error('Fetch khata customers error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route   POST /api/khata/customer-payment
 * @desc    Record a general payment towards a customer's total outstanding balance
 */
router.post('/customer-payment', auth, async (req, res) => {
    try {
        const tenantId = await getTenantId(req);
        const { customerPhone, customerName, amount, paymentMethod, notes } = req.body;

        const cleanPhone = String(customerPhone || '').replace(/[^0-9]/g, '');
        const payAmount = Number(amount);

        if (isNaN(payAmount) || payAmount <= 0) {
            return res.status(400).json({ success: false, error: 'Valid payment amount is required' });
        }

        let match = {
            status: { $in: ['pending', 'partially_settled'] }
        };

        if (cleanPhone && cleanPhone !== 'N/A') {
            match.customerPhone = cleanPhone;
        } else if (customerName) {
            match.customerName = customerName;
        } else {
            return res.status(400).json({ success: false, error: 'Customer identifier is required' });
        }

        if (tenantId) {
            try {
                const objId = new mongoose.Types.ObjectId(tenantId);
                match.$or = [{ tenantId: objId }, { tenantId: String(tenantId) }];
            } catch (e) {
                match.tenantId = tenantId;
            }
        }

        // Find pending records sorted oldest first
        const pendingRecords = await KhataRecord.find(match).sort({ createdAt: 1 });

        if (pendingRecords.length === 0) {
            return res.status(400).json({ success: false, error: 'No pending khata dues found for this customer' });
        }

        let remainingPayment = payAmount;
        let recordsUpdated = 0;

        for (const record of pendingRecords) {
            if (remainingPayment <= 0) break;

            const applyAmount = Math.min(record.borrowAmount, remainingPayment);
            record.paidAmount = (record.paidAmount || 0) + applyAmount;
            record.borrowAmount = Math.max(0, record.borrowAmount - applyAmount);

            if (record.borrowAmount === 0) {
                record.status = 'settled';
            } else {
                record.status = 'partially_settled';
            }

            const cleanMethod = (paymentMethod || 'cash').toLowerCase();
            const validMethod = ['cash', 'upi', 'card'].includes(cleanMethod) ? cleanMethod : 'cash';

            record.settlementHistory.push({
                amount: applyAmount,
                paymentMethod: validMethod,
                settledAt: new Date(),
                settledBy: req.user?.name || req.user?.email || 'Staff',
                notes: notes || 'Bulk customer payment'
            });

            record.updatedAt = new Date();
            await record.save();
            remainingPayment -= applyAmount;
            recordsUpdated++;
        }

        res.json({
            success: true,
            message: `Recorded payment of ₹${payAmount - remainingPayment} across ${recordsUpdated} pending bill(s).`,
            amountPaid: payAmount - remainingPayment,
            excessAmount: remainingPayment
        });
    } catch (err) {
        console.error('Customer payment error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;

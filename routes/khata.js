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
    let tenantId = req.user?.tenantId || req.tenantId;
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
        const query = tenantId ? { tenantId } : {};
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
        const { orderId, orderNumber, customerName, customerPhone, totalBill, paidAmount, borrowAmount, notes } = req.body;

        if (!customerName || !customerPhone || borrowAmount === undefined) {
            return res.status(400).json({ success: false, error: 'Customer Name, Phone, and Borrow Amount are required' });
        }

        const cleanPhone = String(customerPhone).replace(/[^0-9]/g, '');

        const newRecord = new KhataRecord({
            tenantId,
            orderId: orderId || null,
            orderNumber: orderNumber || '',
            customerName: customerName.trim(),
            customerPhone: cleanPhone || customerPhone.trim(),
            totalBill: Number(totalBill) || (Number(paidAmount || 0) + Number(borrowAmount)),
            paidAmount: Number(paidAmount) || 0,
            borrowAmount: Number(borrowAmount),
            notes: notes || '',
            status: Number(borrowAmount) <= 0 ? 'settled' : (Number(paidAmount) > 0 ? 'partially_settled' : 'pending')
        });

        await newRecord.save();
        res.status(201).json({ success: true, message: `Khata record created for ${customerName} (₹${borrowAmount} pending)`, record: newRecord });
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
        if (!record) return res.status(404).json({ success: false, error: 'Khata record not found' });

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

        res.json({ success: true, message: 'Khata record removed successfully' });
    } catch (err) {
        console.error('Delete khata error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete khata record: ' + err.message });
    }
});

module.exports = router;


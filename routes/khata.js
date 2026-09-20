const express = require('express');
const router = express.Router();
const KhataRecord = require('../models/KhataRecord');
const Order = require('../models/Order');
const auth = require('../middleware/auth');

/**
 * @route   GET /api/khata
 * @desc    Get all khata (borrow) records for the authenticated tenant
 * @access  Private
 */
router.get('/', auth, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const records = await KhataRecord.find({ tenantId }).sort({ createdAt: -1 });

        const totalOutstanding = records
            .filter(r => r.status !== 'settled')
            .reduce((sum, r) => sum + (r.borrowAmount || 0), 0);

        const totalRecovered = records
            .reduce((sum, r) => sum + (r.paidAmount || 0), 0);

        res.json({
            records,
            totalOutstanding,
            totalRecovered,
            count: records.length
        });
    } catch (err) {
        console.error('Fetch khata records error:', err);
        res.status(500).json({ error: 'Failed to fetch khata records' });
    }
});

/**
 * @route   POST /api/khata
 * @desc    Create a new borrow record (called from POS settlement or standalone)
 * @access  Private
 */
router.post('/', auth, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { orderId, orderNumber, customerName, customerPhone, totalBill, paidAmount, borrowAmount, notes } = req.body;

        if (!customerName || !customerPhone || borrowAmount === undefined) {
            return res.status(400).json({ error: 'Customer Name, Phone, and Borrow Amount are required' });
        }

        const newRecord = new KhataRecord({
            tenantId,
            orderId: orderId || null,
            orderNumber: orderNumber || '',
            customerName: customerName.trim(),
            customerPhone: customerPhone.replace(/[^0-9]/g, ''),
            totalBill: Number(totalBill) || Number(borrowAmount),
            paidAmount: Number(paidAmount) || 0,
            borrowAmount: Number(borrowAmount),
            notes: notes || '',
            status: Number(borrowAmount) <= 0 ? 'settled' : 'pending'
        });

        await newRecord.save();
        res.status(201).json({ success: true, message: `Khata record created for ${customerName} (₹${borrowAmount} pending)`, record: newRecord });
    } catch (err) {
        console.error('Create khata record error:', err);
        res.status(500).json({ error: 'Failed to create khata record: ' + err.message });
    }
});

/**
 * @route   PUT /api/khata/:id/settle
 * @desc    Record a debt payment from customer to settle borrow
 * @access  Private
 */
router.put('/:id/settle', auth, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { amountReceived, paymentMethod, notes } = req.body;

        const record = await KhataRecord.findOne({ _id: req.params.id, tenantId });
        if (!record) return res.status(404).json({ error: 'Khata record not found' });

        const received = Math.min(record.borrowAmount, Number(amountReceived) || record.borrowAmount);
        record.paidAmount += received;
        record.borrowAmount -= received;

        if (record.borrowAmount <= 0) {
            record.borrowAmount = 0;
            record.status = 'settled';
        } else {
            record.status = 'partially_settled';
        }

        record.settlementHistory.push({
            amount: received,
            paymentMethod: paymentMethod || 'cash',
            settledAt: new Date(),
            settledBy: req.user.name || 'Staff',
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
        res.status(500).json({ error: 'Failed to settle khata: ' + err.message });
    }
});

module.exports = router;

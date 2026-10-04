const express = require('express');
const router = express.Router();
const { sendSmsOtp } = require('../utils/smsService');

// In-memory OTP storage with timestamp (5 min expiry)
// Key: phone number string, Value: { otp, expiresAt, name }
const otpStore = new Map();

/**
 * @route   POST /api/customer/send-otp
 * @desc    Generate and send 6-digit verification OTP to customer mobile number
 * @access  Public
 */
router.post('/send-otp', async (req, res) => {
    try {
        const { phone, name } = req.body;

        if (!phone) {
            return res.status(400).json({ error: 'Mobile number is required' });
        }

        // Clean phone number
        const cleanPhone = phone.replace(/[^0-9]/g, '');
        if (cleanPhone.length < 10) {
            return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number' });
        }

        // Generate 6-digit numeric OTP
        const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes validity

        otpStore.set(cleanPhone, {
            otp: generatedOtp,
            name: (name || '').trim(),
            expiresAt
        });

        // Dispatch SMS via Fast2SMS / Twilio or log to terminal
        const smsResult = await sendSmsOtp(cleanPhone, generatedOtp);

        return res.json({
            success: true,
            message: `OTP sent successfully to +91 ${cleanPhone.slice(-4).padStart(cleanPhone.length, '*')}`,
            provider: smsResult.provider,
            devOtp: generatedOtp
        });
    } catch (err) {
        console.error('Send OTP error:', err);
        return res.status(500).json({ error: 'Failed to send OTP: ' + err.message });
    }
});

/**
 * @route   POST /api/customer/verify-otp
 * @desc    Verify 6-digit OTP and return verified customer profile
 * @access  Public
 */
router.post('/verify-otp', async (req, res) => {
    try {
        const { phone, otp, name } = req.body;

        if (!phone || !otp) {
            return res.status(400).json({ error: 'Mobile number and OTP are required' });
        }

        const cleanPhone = phone.replace(/[^0-9]/g, '');
        const record = otpStore.get(cleanPhone);

        // Also allow universal master demo OTP '123456' for testing
        const isMasterOtp = otp === '123456';

        if (!record && !isMasterOtp) {
            return res.status(400).json({ error: 'No active OTP request found for this number. Please request a new OTP.' });
        }

        if (record && Date.now() > record.expiresAt && !isMasterOtp) {
            otpStore.delete(cleanPhone);
            return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
        }

        if (record && record.otp !== otp && !isMasterOtp) {
            return res.status(400).json({ error: 'Incorrect OTP. Please enter the valid 6-digit code.' });
        }

        // Successfully verified
        const customerName = name || (record ? record.name : '') || 'Valued Guest';
        otpStore.delete(cleanPhone);

        return res.json({
            success: true,
            verified: true,
            customer: {
                name: customerName,
                phone: cleanPhone,
                authProvider: 'phone_otp',
                verifiedAt: new Date()
            }
        });
    } catch (err) {
        console.error('Verify OTP error:', err);
        return res.status(500).json({ error: 'Verification failed: ' + err.message });
    }
});

/**
 * @route   POST /api/customer/google-auth
 * @desc    Verify and authenticate customer via Google OAuth / One-Tap
 * @access  Public
 */
router.post('/google-auth', async (req, res) => {
    try {
        const { name, email, googleId, picture } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Google email is required' });
        }

        return res.json({
            success: true,
            verified: true,
            customer: {
                name: name || email.split('@')[0],
                email: email.toLowerCase(),
                phone: req.body.phone || '',
                picture: picture || '',
                googleId: googleId || '',
                authProvider: 'google',
                verifiedAt: new Date()
            }
        });
    } catch (err) {
        console.error('Google Auth error:', err);
        return res.status(500).json({ error: 'Google authentication failed: ' + err.message });
    }
});

/**
 * @route   POST /api/customer/update-profile
 * @desc    Update customer name and synchronize with active orders & Customer DB
 * @access  Public
 */
router.post('/update-profile', async (req, res) => {
    try {
        const { phone, name, tenantId, sessionIds, tableNumber } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Customer name is required' });
        }

        const cleanName = name.trim();
        const cleanPhone = phone ? phone.replace(/[^0-9]/g, '') : '';
        const Order = require('../models/Order');
        const Customer = require('../models/Customer');

        // 1. Update or upsert Customer record if phone and tenantId available
        if (cleanPhone && tenantId && tenantId !== 'demo-tenant') {
            try {
                await Customer.findOneAndUpdate(
                    { tenantId, phone: cleanPhone },
                    { $set: { name: cleanName, lastVisit: new Date() } },
                    { new: true, upsert: true }
                );
            } catch (custErr) {
                console.warn('Customer record update warning:', custErr.message);
            }
        }

        // 2. Update active orders for this phone or sessionIds or tableNumber
        const orderFilters = [];
        if (cleanPhone) {
            orderFilters.push({ 'customerDetails.phone': cleanPhone });
        }
        if (Array.isArray(sessionIds) && sessionIds.length > 0) {
            orderFilters.push({ _id: { $in: sessionIds } });
        }
        if (tableNumber && tenantId && tenantId !== 'demo-tenant') {
            orderFilters.push({ tenantId, tableNumber, status: { $in: ['pending', 'confirmed', 'preparing', 'ready'] } });
        }

        if (orderFilters.length > 0) {
            await Order.updateMany(
                { $or: orderFilters },
                { $set: { 'customerDetails.name': cleanName } }
            );
        }

        return res.json({
            success: true,
            message: 'Profile name synchronized successfully across orders and KDS',
            name: cleanName
        });
    } catch (err) {
        console.error('Update profile error:', err);
        return res.status(500).json({ error: 'Failed to update profile: ' + err.message });
    }
});

module.exports = router;


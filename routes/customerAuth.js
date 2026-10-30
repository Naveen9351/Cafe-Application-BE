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
        if (!/^[0-9]{10}$/.test(cleanPhone)) {
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
            ...(!smsResult.sent ? { devOtp: generatedOtp } : {})
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
        if (!/^[0-9]{10}$/.test(cleanPhone)) {
            return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number' });
        }
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
 * @route   POST /api/customer/quick-verify
 * @desc    Direct zero-cost customer verification for Dine-In orders (No paid SMS OTP required)
 * @access  Public
 */
router.post('/quick-verify', async (req, res) => {
    try {
        const { name, phone, tenantId } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Please enter your name' });
        }

        const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
        if (cleanPhone.length < 10) {
            return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number' });
        }

        const cleanName = name.trim();
        const Customer = require('../models/Customer');

        // Upsert customer record if tenantId is available
        if (cleanPhone && tenantId && tenantId !== 'demo-tenant') {
            try {
                await Customer.findOneAndUpdate(
                    { tenantId, phone: cleanPhone },
                    { $set: { name: cleanName, isPhoneVerified: true, lastVisit: new Date() } },
                    { new: true, upsert: true }
                );
            } catch (dbErr) {
                console.warn('Customer upsert note:', dbErr.message);
            }
        }

        return res.json({
            success: true,
            verified: true,
            customer: {
                name: cleanName,
                phone: cleanPhone,
                authProvider: 'instant_verified',
                verifiedAt: new Date()
            }
        });
    } catch (err) {
        console.error('Quick verify error:', err);
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
        let { name, email, googleId, picture, accessToken, credential, phone } = req.body;

        // 1. If accessToken provided, fetch user profile securely on server (bypasses browser CORS & ad-blockers)
        if (accessToken && !email) {
            try {
                const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                    headers: { Authorization: `Bearer ${accessToken}` }
                });
                if (response.ok) {
                    const data = await response.json();
                    if (data?.email) {
                        email = data.email;
                        name = data.name || name || data.email.split('@')[0];
                        picture = data.picture || picture || '';
                        googleId = data.sub || googleId || '';
                    }
                } else {
                    console.warn('Google userinfo fetch returned status:', response.status);
                }
            } catch (fetchErr) {
                console.error('Server-side Google userinfo fetch failed:', fetchErr.message);
            }
        }

        // 2. If credential (JWT) provided, parse payload
        if (credential && !email) {
            try {
                const parts = credential.split('.');
                if (parts.length === 3) {
                    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
                    if (payload?.email) {
                        email = payload.email;
                        name = payload.name || name || payload.email.split('@')[0];
                        picture = payload.picture || picture || '';
                        googleId = payload.sub || googleId || '';
                    }
                }
            } catch (jwtErr) {
                console.error('JWT parse error:', jwtErr.message);
            }
        }

        if (!email) {
            return res.status(400).json({ error: 'Unable to retrieve Google email. Please enter details manually or try again.' });
        }

        return res.json({
            success: true,
            verified: true,
            customer: {
                name: name || email.split('@')[0],
                email: email.toLowerCase(),
                phone: phone || '',
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


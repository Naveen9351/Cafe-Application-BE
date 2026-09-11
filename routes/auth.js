const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Tenant = require('../models/Tenant');

// Login Route
router.post(
    '/login',
    [
        body('email').trim().isEmail().withMessage('Please enter a valid email address'),
        body('password').notEmpty().withMessage('Password is required'),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                error: errors.array()[0].msg,
                errors: errors.array() 
            });
        }

        const { email, password } = req.body;

        try {
            const user = await User.findOne({ email: email.toLowerCase() }).populate('tenantId');

            if (!user) {
                return res.status(400).json({ error: 'Invalid email or password' });
            }

            // MIGRATION FIX: If user is "old" admin and missing name/role, fix it on the fly
            if (!user.name) {
                user.name = "Legacy Admin";
                if (!user.role) user.role = 'super_admin'; // Assume legacy admin is super admin
                if (!user.tenantId && user.role !== 'super_admin') {
                    // Force super_admin for safety if it matches env admin
                    if (email === process.env.ADMIN_EMAIL) {
                        user.role = 'super_admin';
                    }
                }
            }

            // Check User Status
            if (user.status !== 'active') {
                return res.status(403).json({ error: 'Your account is inactive or suspended. Please contact support.' });
            }

            // Check Password
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(400).json({ error: 'Invalid email or password' });
            }

            // Check Tenant Subscription if not Super Admin
            if (user.role !== 'super_admin' && user.tenantId) {
                if (!user.tenantId.subscription.isActive) {
                    return res.status(403).json({ error: 'Your restaurant subscription is inactive. Please renew your plan.' });
                }
            }

            // Create Token
            const payload = {
                id: user._id,
                role: user.role,
                tenantId: user.tenantId?._id || null
            };

            const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' });

            // Update Last Login
            user.lastLogin = new Date();

            try {
                await user.save();
            } catch (saveErr) {
                console.warn("Could not save last login timestamp:", saveErr.message);
            }

            res.json({
                token,
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    tenantId: user.tenantId?._id || null,
                    tenantName: user.tenantId?.name || 'Platform Admin'
                }
            });
        } catch (err) {
            console.error('Login error:', err);
            res.status(500).json({ error: 'Server error occurred during login. Please try again.' });
        }
    }
);

// Verify Session Route
router.get('/verify-session', async (req, res) => {
    const token = req.header('x-auth-token') || req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ error: 'No token provided', valid: false });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('-password').populate('tenantId');
        if (!user || user.status !== 'active') {
            return res.status(401).json({ error: 'Session invalid or account deactivated', valid: false });
        }

        res.json({
            valid: true,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                tenantId: user.tenantId?._id || null,
                tenantName: user.tenantId?.name || 'Platform Admin'
            }
        });
    } catch (err) {
        res.status(401).json({ error: 'Token expired or invalid', valid: false });
    }
});

// Register Tenant (Public SaaS Onboarding)
router.post(
    '/register-tenant',
    [
        body('businessName').trim().notEmpty().withMessage('Restaurant / Business name is required'),
        body('email').trim().isEmail().withMessage('Please provide a valid email address'),
        body('phone')
            .trim()
            .matches(/^[0-9]{10}$/)
            .withMessage('Mobile number must be exactly 10 digits (numbers only)'),
        body('password')
            .isLength({ min: 8 })
            .withMessage('Password must be at least 8 characters long')
            .matches(/[A-Z]/)
            .withMessage('Password must contain at least one uppercase letter')
            .matches(/[a-z]/)
            .withMessage('Password must contain at least one lowercase letter')
            .matches(/[0-9]/)
            .withMessage('Password must contain at least one integer number')
            .matches(/[^A-Za-z0-9]/)
            .withMessage('Password must contain at least one special character (!@#$%^&*...)'),
        body('address').trim().notEmpty().withMessage('Location or address is required')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                error: errors.array()[0].msg,
                errors: errors.array() 
            });
        }

        const { businessName, email, password, phone, address } = req.body;

        try {
            // 1. Check if user or tenant exists
            let userExists = await User.findOne({ email: email.toLowerCase() });
            if (userExists) {
                return res.status(400).json({ 
                    error: 'An account with this email already exists. Please log in.',
                    field: 'email'
                });
            }

            // 2. Create Tenant
            const tenant = new Tenant({
                name: businessName,
                email: email.toLowerCase(),
                phone,
                address,
                subscription: {
                    plan: 'free_trial',
                    startDate: new Date(),
                    endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
                    isActive: true
                }
            });
            await tenant.save();

            // 3. Create Admin User for Tenant
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            const user = new User({
                tenantId: tenant._id,
                name: businessName,
                email: email.toLowerCase(),
                password: hashedPassword,
                role: 'admin',
                status: 'active'
            });
            await user.save();

            // 4. Update Tenant Owner
            tenant.ownerId = user._id;
            await tenant.save();

            res.status(201).json({ 
                message: 'Tenant registered successfully', 
                tenantId: tenant._id 
            });

        } catch (err) {
            console.error('Registration error:', err);
            res.status(500).json({ error: 'Server error during registration. Please try again later.' });
        }
    }
);

module.exports = router;

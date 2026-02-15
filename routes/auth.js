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
        body('email').isEmail().withMessage('Invalid email format'),
        body('password').notEmpty().withMessage('Password is required'),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;

        try {
            const user = await User.findOne({ email }).populate('tenantId');

            if (!user) {
                return res.status(400).json({ error: 'Invalid credentials' });
            }

            // MIGRATION FIX: If user is "old" admin and missing name/role, fix it on the fly
            if (!user.name) {
                user.name = "Legacy Admin";
                if (!user.role) user.role = 'super_admin'; // Assume legacy admin is super admin
                if (!user.tenantId && user.role !== 'super_admin') {
                    // If for some reason they aren't super admin but have no tenant, this is bad state.
                    // Force super_admin for safety if it matches env admin
                    if (email === process.env.ADMIN_EMAIL) {
                        user.role = 'super_admin';
                    }
                }
            }

            // Check User Status
            if (user.status !== 'active') {
                return res.status(403).json({ error: 'Account is inactive or suspended' });
            }

            // Check Password
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(400).json({ error: 'Invalid credentials' });
            }

            // Check Tenant Subscription if not Super Admin
            if (user.role !== 'super_admin' && user.tenantId) {
                if (!user.tenantId.subscription.isActive) {
                    return res.status(403).json({ error: 'Tenant subscription is inactive' });
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

            // Bypass validation for legacy fields if needed, or rely on the fix above
            // We'll use validateBeforeSave: false only if absolutely necessary, but better to fix data
            try {
                await user.save();
            } catch (saveErr) {
                console.warn("Could not save last login timestamp due to validation error (legacy user?):", saveErr.message);
                // Swallow error, don't block login
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
            res.status(500).json({ error: 'Server error: ' + err.message });
        }
    }
);

// Register Tenant (Public or Super Admin only? Let's assume Public for SaaS)
router.post(
    '/register-tenant',
    [
        body('businessName').notEmpty(),
        body('email').isEmail(),
        body('password').isLength({ min: 6 }),
        body('phone').notEmpty()
    ],
    async (req, res) => {
        // Transactional logic ideal here
        const { businessName, email, password, phone, address } = req.body;

        try {
            // 1. Check if user or tenant exists
            let userExists = await User.findOne({ email });
            if (userExists) return res.status(400).json({ error: 'Email already registered' });

            // 2. Create Tenant
            const tenant = new Tenant({
                name: businessName,
                email,
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
                name: `Admin - ${businessName}`, // defaulting name
                email,
                password: hashedPassword,
                role: 'admin',
                status: 'active'
            });
            await user.save();

            // 4. Update Tenant Owner
            tenant.ownerId = user._id;
            await tenant.save();

            res.status(201).json({ message: 'Tenant registered successfully', tenantId: tenant._id });

        } catch (err) {
            console.error('Registration error:', err);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

module.exports = router;

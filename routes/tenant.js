const express = require('express');
const router = express.Router();
const Tenant = require('../models/Tenant');
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');

const bcrypt = require('bcryptjs');
const User = require('../models/User');

// Get all tenants (Super Admin only)
router.get('/', [auth, checkRole(['super_admin'])], async (req, res) => {
    try {
        const tenants = await Tenant.find().sort({ createdAt: -1 });
        res.json(tenants);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Onboard New Cafe (Super Admin only)
router.post('/onboard', [auth, checkRole(['super_admin'])], async (req, res) => {
    try {
        const { businessName, adminName, email, password, phone, address, logo, profileImage, plan, customPrice } = req.body;

        if (!businessName || !email || !password) {
            return res.status(400).json({ error: 'Business name, email, and password are required' });
        }

        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ error: 'User with this email already exists' });
        }

        const plans = {
            '1_month': { name: '1 Month Starter', price: 999, duration: 30 },
            '6_months': { name: '6 Months Saver', price: 4999, duration: 180 },
            '1_year': { name: '1 Year Ultimate Pro', price: 10999, duration: 365 },
            'free_trial': { name: 'Free Trial', price: 0, duration: 14 }
        };

        const planConfig = plans[plan] || plans['1_month'];
        const price = customPrice !== undefined ? Number(customPrice) : planConfig.price;

        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + planConfig.duration);

        // Create Tenant
        const tenant = new Tenant({
            name: businessName,
            email: email.toLowerCase(),
            phone: phone || '',
            address: address || '',
            subscription: {
                plan: plan || '1_month',
                price: price,
                startDate: startDate,
                endDate: endDate,
                isActive: true,
                orderLimit: 999999
            },
            subscriptionHistory: [
                {
                    plan: planConfig.name,
                    price: price,
                    startDate: startDate,
                    endDate: endDate,
                    status: 'active',
                    actionDate: new Date(),
                    notes: 'Initial Onboarding Plan'
                }
            ],
            settings: {
                logo: logo || 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&q=80&w=400'
            }
        });
        await tenant.save();

        // Create Admin User for Tenant
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const user = new User({
            tenantId: tenant._id,
            name: adminName || businessName,
            email: email.toLowerCase(),
            password: hashedPassword,
            role: 'admin',
            status: 'active',
            profileImage: profileImage || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=300'
        });
        await user.save();

        tenant.ownerId = user._id;
        await tenant.save();

        res.status(201).json({ message: 'Cafe onboarded successfully', tenant, user });
    } catch (err) {
        console.error("Onboard error:", err);
        res.status(500).json({ error: 'Failed to onboard cafe: ' + err.message });
    }
});

// Get Public Tenant Info (For Branding: Name, Logo, Address)
router.get('/public/:id', async (req, res) => {
    try {
        const tenant = await Tenant.findById(req.params.id).select('name logo address phone email gstNumber settings subscription subscriptionHistory');
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
        res.json(tenant);
    } catch (err) {
        console.error("Fetch public tenant error:", err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update Tenant Identity & General Settings (Admin/Owner)
router.put('/:id', auth, async (req, res) => {
    try {
        const tenantId = req.params.id || req.user.tenantId;
        const { name, restaurantName, address, storeAddress, phone, primaryPhone, email, publicEmail, gstNumber, operatingHours, logo, accentColor, enableGst, enableGratuity } = req.body;

        const tenant = await Tenant.findById(tenantId);
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        if (name || restaurantName) tenant.name = name || restaurantName;
        if (address || storeAddress) tenant.address = address || storeAddress;
        if (phone || primaryPhone) tenant.phone = phone || primaryPhone;
        if (email || publicEmail) tenant.email = email || publicEmail;
        if (gstNumber) tenant.gstNumber = gstNumber;
        if (logo) {
            tenant.logo = logo;
            if (!tenant.settings) tenant.settings = {};
            tenant.settings.logo = logo;
        }
        
        if (!tenant.settings) tenant.settings = {};
        if (operatingHours) tenant.settings.operatingHours = operatingHours;
        if (accentColor) tenant.settings.theme = accentColor;
        if (enableGst !== undefined) tenant.settings.enableGst = enableGst;
        if (enableGratuity !== undefined) tenant.settings.enableGratuity = enableGratuity;
        if (req.body.enableEstimatedPrepTime !== undefined) {
            tenant.settings.enableEstimatedPrepTime = Boolean(req.body.enableEstimatedPrepTime);
        }

        await tenant.save();
        res.json(tenant);
    } catch (err) {
        console.error("Update tenant error:", err);
        res.status(500).json({ error: "Failed to update tenant" });
    }
});

// Update / Activate Tenant Subscription Plan (Super Admin)
router.put('/:id/subscription', [auth, checkRole(['super_admin'])], async (req, res) => {
    try {
        const { plan, customPrice, customEndDate } = req.body; 

        const tenant = await Tenant.findById(req.params.id);
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        const plans = {
            '1_month': { name: '1 Month Starter', price: 999, duration: 30 },
            '6_months': { name: '6 Months Saver', price: 4999, duration: 180 },
            '1_year': { name: '1 Year Ultimate Pro', price: 10999, duration: 365 },
            'free_trial': { name: 'Free Trial', price: 0, duration: 14 }
        };

        const planConfig = plans[plan] || { name: plan || 'Custom Plan', price: customPrice || 999, duration: 30 };
        const price = customPrice !== undefined ? Number(customPrice) : planConfig.price;

        const startDate = new Date();
        let endDate;
        if (customEndDate) {
            endDate = new Date(customEndDate);
        } else {
            endDate = new Date();
            endDate.setDate(endDate.getDate() + planConfig.duration);
        }

        tenant.subscription = {
            plan: plan || '1_month',
            price: price,
            startDate: startDate,
            endDate: endDate,
            isActive: true,
            orderLimit: 999999,
            orderCount: tenant.subscription?.orderCount || 0,
            features: {
                emailSupport: true,
                prioritySupport: true,
                customBranding: true,
                orderTimer: true,
                advancedAnalytics: true
            }
        };

        if (!tenant.subscriptionHistory) tenant.subscriptionHistory = [];
        tenant.subscriptionHistory.push({
            plan: planConfig.name || plan,
            price: price,
            startDate: startDate,
            endDate: endDate,
            status: 'active',
            actionDate: new Date(),
            notes: 'Activated by Admin'
        });

        await tenant.save();
        res.json(tenant);
    } catch (err) {
        console.error("Subscription update error:", err);
        res.status(500).json({ error: "Subscription update failed" });
    }
});

// Deactivate Tenant Subscription (Super Admin)
router.put('/:id/deactivate-subscription', [auth, checkRole(['super_admin'])], async (req, res) => {
    try {
        const tenant = await Tenant.findById(req.params.id);
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        tenant.subscription.isActive = false;

        if (!tenant.subscriptionHistory) tenant.subscriptionHistory = [];
        tenant.subscriptionHistory.push({
            plan: tenant.subscription.plan,
            price: tenant.subscription.price,
            startDate: tenant.subscription.startDate,
            endDate: tenant.subscription.endDate,
            status: 'deactivated',
            actionDate: new Date(),
            notes: 'Deactivated in-between by Admin'
        });

        await tenant.save();
        res.json(tenant);
    } catch (err) {
        console.error("Deactivation error:", err);
        res.status(500).json({ error: "Deactivation failed" });
    }
});

// Get Subscription History (Super Admin or Cafe Admin)
router.get('/:id/subscription-history', auth, async (req, res) => {
    try {
        const tenant = await Tenant.findById(req.params.id).select('name subscription subscriptionHistory');
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
        res.json({
            currentSubscription: tenant.subscription,
            history: tenant.subscriptionHistory || []
        });
    } catch (err) {
        console.error("Fetch history error:", err);
        res.status(500).json({ error: "Failed to fetch history" });
    }
});

// Update Tenant Settings (Category, Theme etc.) - For Admin/Staff
router.put('/settings', auth, async (req, res) => {
    try {
        const tenantId = req.user.tenantId; // From auth middleware
        const { categories, theme, logo, currency, taxPercentage } = req.body;

        const tenant = await Tenant.findById(tenantId);
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        // Update fields if provided
        if (categories) tenant.settings.categories = categories;
        if (theme) tenant.settings.theme = theme;
        if (logo) tenant.settings.logo = logo;
        if (currency) tenant.settings.currency = currency;
        if (taxPercentage !== undefined) tenant.settings.taxPercentage = taxPercentage;

        await tenant.save();
        res.json(tenant.settings);
    } catch (err) {
        console.error("Settings update error:", err);
        res.status(500).json({ error: "Failed to update settings" });
    }
});

// Delete Tenant (Super Admin Only)
router.delete('/:id', [auth, checkRole(['super_admin'])], async (req, res) => {
    try {
        const tenantId = req.params.id;

        // 1. Check if tenant exists
        const tenant = await Tenant.findById(tenantId);
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        // 2. Perform Cascading Deletion
        const User = require('../models/User');
        const MenuItem = require('../models/MenuItem');
        const Order = require('../models/Order');

        await User.deleteMany({ tenantId });
        await MenuItem.deleteMany({ tenantId });
        await Order.deleteMany({ tenantId });
        await Tenant.findByIdAndDelete(tenantId);

        res.json({ message: 'Tenant and all associated data deleted successfully' });
    } catch (err) {
        console.error("Delete tenant error:", err);
        res.status(500).json({ error: "Failed to delete tenant" });
    }
});

module.exports = router;

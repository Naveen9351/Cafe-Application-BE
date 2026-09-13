const express = require('express');
const router = express.Router();
const Tenant = require('../models/Tenant');
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');

// Get all tenants (Super Admin only)
router.get('/', [auth, checkRole(['super_admin'])], async (req, res) => {
    try {
        const tenants = await Tenant.find().sort({ createdAt: -1 });
        res.json(tenants);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Get Public Tenant Info (For Branding: Name, Logo, Address)
router.get('/public/:id', async (req, res) => {
    try {
        const tenant = await Tenant.findById(req.params.id).select('name address phone email settings');
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
        if (logo) tenant.logo = logo;
        
        if (!tenant.settings) tenant.settings = {};
        if (operatingHours) tenant.settings.operatingHours = operatingHours;
        if (accentColor) tenant.settings.theme = accentColor;
        if (enableGst !== undefined) tenant.settings.enableGst = enableGst;
        if (enableGratuity !== undefined) tenant.settings.enableGratuity = enableGratuity;

        await tenant.save();
        res.json(tenant);
    } catch (err) {
        console.error("Update tenant error:", err);
        res.status(500).json({ error: "Failed to update tenant" });
    }
});

// Update Tenant Subscription/Plan (Super Admin)
router.put('/:id/subscription', [auth, checkRole(['super_admin'])], async (req, res) => {
    try {
        const { plan } = req.body; // Plan name: 'free_trial', 'basic', 'enterprise'

        const tenant = await Tenant.findById(req.params.id);
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        // Define Plan Limits
        const plans = {
            'free_trial': {
                price: 0,
                limit: 50,
                duration: 30, // Days
                features: { emailSupport: false, prioritySupport: false, customBranding: false, orderTimer: false, advancedAnalytics: false }
            },
            'basic': { // ₹100 Plan
                price: 100,
                limit: 200,
                duration: 30,
                features: { emailSupport: true, prioritySupport: true, customBranding: false, orderTimer: false, advancedAnalytics: true }
            },
            'enterprise': { // ₹500 Plan
                price: 500,
                limit: 999999, // Unlimited
                duration: 30,
                features: { emailSupport: true, prioritySupport: true, customBranding: true, orderTimer: true, advancedAnalytics: true }
            }
        };

        const selectedPlan = plans[plan];
        if (!selectedPlan) return res.status(400).json({ error: "Invalid plan selected" });

        // Update Subscription
        tenant.subscription.plan = plan;
        tenant.subscription.price = selectedPlan.price;
        tenant.subscription.orderLimit = selectedPlan.limit;
        tenant.subscription.features = selectedPlan.features;
        tenant.subscription.isActive = true;
        tenant.subscription.startDate = new Date(); // Reset start date

        // Set End Date (+30 days)
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + selectedPlan.duration);
        tenant.subscription.endDate = endDate;

        // Reset usage count on plan change? 
        // tenant.subscription.orderCount = 0; // Optional: Reset usage if new plan starts

        await tenant.save();
        res.json(tenant);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Update failed" });
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

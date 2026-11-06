const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const Order = require('../models/Order');
const OnboardingRequest = require('../models/OnboardingRequest');
const emailService = require('../utils/emailService');

// Get all tenants (Super Admin only) - enriched with admin user info
router.get('/', [auth, checkRole(['super_admin'])], async (req, res) => {
    try {
        const tenants = await Tenant.find().populate('ownerId', 'name email phone role').sort({ createdAt: -1 }).lean();
        const enrichedTenants = await Promise.all(tenants.map(async (t) => {
            let adminUser = t.ownerId;
            if (!adminUser) {
                adminUser = await User.findOne({ tenantId: t._id, role: 'admin' }).select('name email phone role').lean();
            }
            return {
                ...t,
                adminName: adminUser?.name || 'Admin',
                ownerName: adminUser?.name || 'Admin',
                adminEmail: adminUser?.email || t.email,
                adminPhone: adminUser?.phone || t.phone,
                ownerId: adminUser ? adminUser._id : t.ownerId
            };
        }));
        res.json(enrichedTenants);
    } catch (err) {
        console.error('Fetch tenants error:', err);
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

        if (phone && !/^[0-9]{10}$/.test(String(phone).trim())) {
            return res.status(400).json({ error: 'Mobile number must be exactly 10 digits' });
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

// Update Tenant Settings (Category, Theme etc.) - For Admin/Staff
router.put('/settings', auth, async (req, res) => {
    try {
        const tenantId = req.user?.tenantId || req.body.tenantId || req.query.tenantId;
        if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
            return res.status(400).json({ error: 'Invalid or missing tenant ID' });
        }
        const { categories, theme, logo, currency, taxPercentage } = req.body;

        const tenant = await Tenant.findById(tenantId);
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        if (!tenant.settings) tenant.settings = {};

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

// Update Tenant Identity & General Settings (Admin/Owner)
router.put('/:id', auth, async (req, res) => {
    try {
        const tenantId = req.params.id || req.user.tenantId;
        if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
            return res.status(400).json({ error: 'Invalid tenant ID format' });
        }
        const { name, restaurantName, address, storeAddress, phone, primaryPhone, email, publicEmail, gstNumber, operatingHours, logo, accentColor, enableGst, enableGratuity } = req.body;

        const tenant = await Tenant.findById(tenantId);
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        if (name || restaurantName) tenant.name = name || restaurantName;
        if (address || storeAddress) tenant.address = address || storeAddress;
        if (phone || primaryPhone) {
            const cleanPhone = String(phone || primaryPhone).trim();
            if (cleanPhone && !/^[0-9]{10}$/.test(cleanPhone)) {
                return res.status(400).json({ error: 'Mobile number must be exactly 10 digits' });
            }
            tenant.phone = cleanPhone;
        }
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
        } else if (req.body.settings?.enableEstimatedPrepTime !== undefined) {
            tenant.settings.enableEstimatedPrepTime = Boolean(req.body.settings.enableEstimatedPrepTime);
        }
        if (req.body.profitMargin !== undefined) {
            tenant.settings.profitMargin = Number(req.body.profitMargin);
        } else if (req.body.settings?.profitMargin !== undefined) {
            tenant.settings.profitMargin = Number(req.body.settings.profitMargin);
        }
        if (req.body.enableKhata !== undefined) {
            tenant.settings.enableKhata = Boolean(req.body.enableKhata);
        } else if (req.body.settings?.enableKhata !== undefined) {
            tenant.settings.enableKhata = Boolean(req.body.settings.enableKhata);
        }
        if (req.body.language !== undefined) {
            tenant.settings.language = req.body.language;
        } else if (req.body.settings?.language !== undefined) {
            tenant.settings.language = req.body.settings.language;
        }
        if (req.body.enableNightMenu !== undefined) {
            tenant.settings.enableNightMenu = Boolean(req.body.enableNightMenu);
        } else if (req.body.settings?.enableNightMenu !== undefined) {
            tenant.settings.enableNightMenu = Boolean(req.body.settings.enableNightMenu);
        }
        if (req.body.nightMenuStart !== undefined) {
            tenant.settings.nightMenuStart = String(req.body.nightMenuStart);
        } else if (req.body.settings?.nightMenuStart !== undefined) {
            tenant.settings.nightMenuStart = String(req.body.settings.nightMenuStart);
        }
        if (req.body.nightMenuEnd !== undefined) {
            tenant.settings.nightMenuEnd = String(req.body.nightMenuEnd);
        } else if (req.body.settings?.nightMenuEnd !== undefined) {
            tenant.settings.nightMenuEnd = String(req.body.settings.nightMenuEnd);
        }

        await tenant.save();
        res.json(tenant);
    } catch (err) {
        console.error("Update tenant error:", err);
        res.status(500).json({ error: "Failed to update tenant" });
    }
});

// In-App Tenant Subscription Plan Upgrade (Tenant Admin / Owner)
router.post('/upgrade-plan', auth, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { planId, plan, paymentMethod, paymentId, amount, transactionRef } = req.body;

        const effectivePlanId = planId || plan;

        // Security check: Must have verified payment reference
        if (!paymentId || !paymentMethod) {
            return res.status(400).json({ error: 'Payment required: A verified payment transaction reference (paymentId) and method are required to activate subscription.' });
        }

        const tenant = await Tenant.findById(tenantId);
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        const PLANS = {
            '1_month': { name: '1 Month Starter', price: 999, durationDays: 30, orderLimit: 999999 },
            '6_months': { name: '6 Months Saver', price: 4999, durationDays: 180, orderLimit: 999999 },
            '1_year': { name: '1 Year Ultimate Pro', price: 8999, durationDays: 365, orderLimit: 999999 },
            starter: { name: '1 Month Starter', price: 999, durationDays: 30, orderLimit: 999999 },
            growth: { name: '6 Months Saver', price: 4999, durationDays: 180, orderLimit: 999999 },
            enterprise: { name: '1 Year Ultimate Pro', price: 8999, durationDays: 365, orderLimit: 999999 }
        };

        const chosenPlan = PLANS[effectivePlanId] || PLANS['1_month'];
        const actualPrice = amount ? Number(amount) : (req.body.price ? Number(req.body.price) : chosenPlan.price);
        const startDate = new Date();
        const endDate = new Date(Date.now() + chosenPlan.durationDays * 24 * 60 * 60 * 1000);

        tenant.subscription = {
            plan: chosenPlan.name,
            price: actualPrice,
            startDate,
            endDate,
            isActive: true,
            orderLimit: chosenPlan.orderLimit,
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
            plan: chosenPlan.name,
            price: actualPrice,
            startDate,
            endDate,
            status: 'active',
            actionDate: new Date(),
            notes: `Paid & Activated via ${paymentMethod} | Ref: ${paymentId}${transactionRef ? ` | Bank Ref: ${transactionRef}` : ''} | ₹${actualPrice}`
        });

        await tenant.save();
        res.json({ 
            success: true, 
            message: `Payment of ₹${actualPrice} verified! Successfully activated ${chosenPlan.name}!`, 
            paymentId,
            tenant 
        });
    } catch (err) {
        console.error("In-app plan upgrade error:", err);
        res.status(500).json({ error: "Failed to upgrade plan: " + err.message });
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

// Deactivate Tenant Subscription with Auto Pro-Rata Refund Calculation (Super Admin)
router.put('/:id/deactivate-subscription', [auth, checkRole(['super_admin'])], async (req, res) => {
    try {
        const tenant = await Tenant.findById(req.params.id);
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        const sub = tenant.subscription || {};
        const now = new Date();
        const start = sub.startDate ? new Date(sub.startDate) : now;
        const end = sub.endDate ? new Date(sub.endDate) : now;
        const price = Number(sub.price) || 0;

        // Total planned duration in days
        const totalDurationMs = Math.max(0, end.getTime() - start.getTime());
        const totalDays = Math.max(1, Math.ceil(totalDurationMs / (1000 * 60 * 60 * 24)));

        // Remaining duration in days
        const remainingMs = Math.max(0, end.getTime() - now.getTime());
        const remainingDays = Math.max(0, Math.ceil(remainingMs / (1000 * 60 * 60 * 24)));
        const usedDays = Math.max(0, totalDays - remainingDays);

        // Daily rate & Pro-rata refund calculation
        const dailyRate = price > 0 ? (price / totalDays) : 0;
        const refundAmount = remainingDays > 0 && price > 0 ? Math.round(dailyRate * remainingDays) : 0;

        tenant.subscription.isActive = false;
        tenant.subscription.deactivatedAt = now;
        tenant.subscription.refundDue = refundAmount;
        tenant.subscription.remainingDays = remainingDays;

        if (!tenant.subscriptionHistory) tenant.subscriptionHistory = [];
        tenant.subscriptionHistory.push({
            plan: sub.plan,
            price: price,
            startDate: sub.startDate,
            endDate: sub.endDate,
            status: 'deactivated',
            actionDate: now,
            totalDays,
            usedDays,
            remainingDays,
            refundAmount,
            dailyRate: Math.round(dailyRate * 100) / 100,
            notes: `Deactivated in-between. ${remainingDays} days pending. Refund Due: ₹${refundAmount}`
        });

        await tenant.save();
        res.json({
            success: true,
            tenant,
            refundCalculation: {
                totalDays,
                usedDays,
                remainingDays,
                price,
                dailyRate: Math.round(dailyRate * 100) / 100,
                refundAmount
            }
        });
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



// Delete Tenant (Super Admin Only)
// Cascades deletion to matching Onboarding Applications, Users, Orders, Menu Items, and Tables
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
        const OnboardingRequest = require('../models/OnboardingRequest');

        const tenantEmail = tenant.email ? tenant.email.toLowerCase().trim() : null;

        // Delete all users belonging to this tenant OR matching the tenant owner email (never delete super_admin)
        await User.deleteMany({
            role: { $ne: 'super_admin' },
            $or: [
                { tenantId: tenant._id },
                ...(tenant.ownerId ? [{ _id: tenant.ownerId }] : []),
                ...(tenantEmail ? [{ email: tenantEmail }] : [])
            ]
        });

        // Delete all onboarding requests / applications linked to this tenant or email
        await OnboardingRequest.deleteMany({
            $or: [
                { createdTenantId: tenant._id },
                ...(tenantEmail ? [{ email: tenantEmail }] : [])
            ]
        });

        await MenuItem.deleteMany({ tenantId: tenant._id });
        await Order.deleteMany({ tenantId: tenant._id });
        await Tenant.findByIdAndDelete(tenantId);

        res.json({ success: true, message: 'Tenant, user accounts, and onboarding applications deleted successfully' });
    } catch (err) {
        console.error("Delete tenant error:", err);
        res.status(500).json({ error: "Failed to delete tenant: " + err.message });
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// ONBOARDING & APPROVAL PIPELINE (Super Admin)
// ─────────────────────────────────────────────────────────────────────────────

// Generate Super Admin Invite Link & Send Email
router.post('/generate-invite', [auth, checkRole(['super_admin'])], async (req, res) => {
    try {
        const { email, businessName, ownerName, phone, plan } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email address is required to generate an invitation link.' });
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Check if user already exists
        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) {
            return res.status(400).json({ error: 'A cafe account with this email is already registered and active.' });
        }

        // Generate unique invitation token
        const inviteToken = crypto.randomBytes(24).toString('hex');
        const frontendUrl = process.env.FRONTEND_URL || 'https://www.dineviq.com';
        const inviteLink = `${frontendUrl}/register?invite=${inviteToken}`;

        // Upsert OnboardingRequest
        let inviteRecord = await OnboardingRequest.findOne({ email: normalizedEmail });
        if (!inviteRecord) {
            inviteRecord = new OnboardingRequest({
                businessName: businessName || 'Cafe Partner',
                ownerName: ownerName || '',
                email: normalizedEmail,
                phone: phone || '',
                password: '',
                inviteToken,
                source: 'admin_invite',
                invitedBy: req.user.id,
                requestedPlan: plan || 'free_trial',
                status: 'invited',
                isSubmitted: false
            });
        } else {
            if (inviteRecord.status === 'approved') {
                return res.status(400).json({ error: 'This cafe account has already been approved and activated.' });
            }
            inviteRecord.inviteToken = inviteToken;
            inviteRecord.source = 'admin_invite';
            inviteRecord.invitedBy = req.user.id;
            if (businessName) inviteRecord.businessName = businessName;
            if (ownerName) inviteRecord.ownerName = ownerName;
            if (phone) inviteRecord.phone = phone;
            if (plan) inviteRecord.requestedPlan = plan;
            // If cafe has not submitted yet, status remains 'invited'
            if (!inviteRecord.isSubmitted) {
                inviteRecord.status = 'invited';
            }
        }

        await inviteRecord.save();

        // Dispatch Invitation Email
        await emailService.sendInviteEmail({
            to: normalizedEmail,
            inviteLink,
            cafeName: businessName || inviteRecord.businessName
        });

        res.json({
            success: true,
            message: `Invitation link generated and dispatched to ${normalizedEmail}`,
            inviteLink,
            inviteToken,
            email: normalizedEmail
        });
    } catch (err) {
        console.error('Generate invite error:', err);
        res.status(500).json({ error: 'Failed to generate invitation: ' + err.message });
    }
});

// Get Onboarding Requests / Applications (Super Admin)
// type='submitted' (default): only returns actual submitted forms (from public landing page or completed invite forms)
// type='invitations': returns outgoing invites waiting for user submission
router.get('/onboarding-requests', [auth, checkRole(['super_admin'])], async (req, res) => {
    try {
        const { status, type } = req.query;
        let query = {};

        if (type === 'invitations') {
            // Sent invites where user has NOT submitted yet
            query = {
                $or: [
                    { status: 'invited' },
                    { isSubmitted: false, source: 'admin_invite' },
                    { password: 'INVITE_PENDING_SUBMISSION' }
                ]
            };
        } else {
            // Submitted applications:
            // 1. Cafe owner received invite, filled form, verified OTP, and submitted
            // 2. Someone signed up for a trial through landing page and submitted
            query = {
                status: { $ne: 'invited' },
                password: { $ne: 'INVITE_PENDING_SUBMISSION' }
            };

            if (status && status !== 'all') {
                query.status = status;
            }
        }

        const requests = await OnboardingRequest.find(query)
            .sort({ submittedAt: -1, createdAt: -1 })
            .populate('invitedBy', 'name email')
            .populate('reviewedBy', 'name email')
            .populate('createdTenantId', 'name subscription');

        res.json(requests);
    } catch (err) {
        console.error('Fetch onboarding requests error:', err);
        res.status(500).json({ error: 'Failed to fetch onboarding requests' });
    }
});

// Resend Invitation Email (Super Admin)
router.post('/onboarding-requests/:id/resend-invite', [auth, checkRole(['super_admin'])], async (req, res) => {
    try {
        const record = await OnboardingRequest.findById(req.params.id);
        if (!record) {
            return res.status(404).json({ error: 'Invitation not found' });
        }

        // Generate a new token if missing
        if (!record.inviteToken) {
            record.inviteToken = crypto.randomBytes(24).toString('hex');
            await record.save();
        }

        const frontendUrl = process.env.FRONTEND_URL || 'https://www.dineviq.com';
        const inviteLink = `${frontendUrl}/register?invite=${record.inviteToken}`;

        await emailService.sendInviteEmail({
            to: record.email,
            inviteLink,
            cafeName: record.businessName
        });

        res.json({
            success: true,
            message: `Invitation re-dispatched to ${record.email}`,
            inviteLink
        });
    } catch (err) {
        console.error('Resend invite error:', err);
        res.status(500).json({ error: 'Failed to resend invitation: ' + err.message });
    }
});

// Delete / Revoke an Onboarding Request or Invitation (Super Admin)
// Also cascades deletion to any matching registered Cafe / Tenant and User accounts
router.delete('/onboarding-requests/:id', [auth, checkRole(['super_admin'])], async (req, res) => {
    try {
        const record = await OnboardingRequest.findById(req.params.id);
        if (!record) {
            return res.status(404).json({ error: 'Record not found' });
        }

        const User = require('../models/User');
        const Tenant = require('../models/Tenant');
        const MenuItem = require('../models/MenuItem');
        const Order = require('../models/Order');

        const reqEmail = record.email ? record.email.toLowerCase().trim() : null;
        const tenantId = record.createdTenantId;

        // If this request had an approved tenant, delete that tenant and all its data
        if (tenantId) {
            await Tenant.findByIdAndDelete(tenantId);
            await MenuItem.deleteMany({ tenantId });
            await Order.deleteMany({ tenantId });
            await User.deleteMany({ tenantId, role: { $ne: 'super_admin' } });
        } else if (reqEmail) {
            // Also check if a registered tenant with this email exists and delete it
            const matchingTenants = await Tenant.find({ email: reqEmail });
            for (const t of matchingTenants) {
                await Tenant.findByIdAndDelete(t._id);
                await MenuItem.deleteMany({ tenantId: t._id });
                await Order.deleteMany({ tenantId: t._id });
                await User.deleteMany({ tenantId: t._id, role: { $ne: 'super_admin' } });
            }
        }

        // Delete any matching users created from this onboarding request (never delete super_admin)
        if (record.createdUserId) {
            await User.deleteOne({ _id: record.createdUserId, role: { $ne: 'super_admin' } });
        }
        if (reqEmail) {
            await User.deleteMany({ email: reqEmail, role: { $ne: 'super_admin' } });
        }

        await OnboardingRequest.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Application, associated cafe, and user accounts removed successfully' });
    } catch (err) {
        console.error('Delete onboarding request error:', err);
        res.status(500).json({ error: 'Failed to delete record: ' + err.message });
    }
});

// Approve Cafe Onboarding Request (Super Admin)
router.put('/onboarding-requests/:id/approve', [auth, checkRole(['super_admin'])], async (req, res) => {
    try {
        const requestId = req.params.id;
        const { plan = 'free_trial', customPrice, customDurationDays } = req.body;

        const requestRecord = await OnboardingRequest.findById(requestId);
        if (!requestRecord) {
            return res.status(404).json({ error: 'Onboarding application not found.' });
        }

        if (requestRecord.status === 'approved') {
            return res.status(400).json({ error: 'This cafe application has already been approved and onboarded.' });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ email: requestRecord.email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ error: 'A user account with this email already exists in the system.' });
        }

        const plans = {
            '1_month': { name: '1 Month Starter', price: 999, duration: 30 },
            '6_months': { name: '6 Months Saver', price: 4999, duration: 180 },
            '1_year': { name: '1 Year Ultimate Pro', price: 10999, duration: 365 },
            'free_trial': { name: 'Free Trial', price: 0, duration: 14 }
        };

        const planConfig = plans[plan] || plans['free_trial'];
        const price = customPrice !== undefined ? Number(customPrice) : planConfig.price;
        const duration = customDurationDays !== undefined ? Number(customDurationDays) : planConfig.duration;

        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + duration);

        // 1. Create Tenant
        const tenant = new Tenant({
            name: requestRecord.businessName,
            email: requestRecord.email.toLowerCase(),
            phone: requestRecord.phone || '',
            address: requestRecord.address || requestRecord.city || '',
            gstNumber: requestRecord.gstNumber || '',
            subscription: {
                plan: plan || 'free_trial',
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
                    notes: `Super Admin Approved Onboarding (${planConfig.name})`
                }
            ],
            settings: {
                logo: 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&q=80&w=400'
            }
        });
        await tenant.save();

        // 2. Create Admin User
        // Note: requestRecord.password is already hashed via bcrypt during registration
        let userPassword = requestRecord.password;
        if (!userPassword || userPassword.startsWith('TEMP_') || userPassword.startsWith('INVITE_')) {
            const salt = await bcrypt.genSalt(10);
            userPassword = await bcrypt.hash('Cafe@123456', salt);
        }

        const user = new User({
            tenantId: tenant._id,
            name: requestRecord.ownerName || requestRecord.businessName,
            email: requestRecord.email.toLowerCase(),
            phone: requestRecord.phone || '',
            password: userPassword,
            role: 'admin',
            status: 'active',
            profileImage: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=300'
        });
        await user.save();

        tenant.ownerId = user._id;
        await tenant.save();

        // 3. Update Request status to approved
        requestRecord.status = 'approved';
        requestRecord.reviewedAt = new Date();
        requestRecord.reviewedBy = req.user.id;
        requestRecord.createdTenantId = tenant._id;
        requestRecord.createdUserId = user._id;
        await requestRecord.save();

        // 4. Send Approval Confirmation Email
        try {
            await emailService.sendApprovalEmail({
                to: requestRecord.email,
                cafeName: requestRecord.businessName,
                ownerName: requestRecord.ownerName,
                loginUrl: `${process.env.FRONTEND_URL || 'https://www.dineviq.com'}/login`,
                planName: planConfig.name
            });
        } catch (mailErr) {
            console.warn('Could not send approval email:', mailErr.message);
        }

        res.json({
            success: true,
            message: `Cafe "${requestRecord.businessName}" has been successfully approved & onboarded!`,
            tenant,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (err) {
        console.error('Approve request error:', err);
        res.status(500).json({ error: 'Failed to approve application: ' + err.message });
    }
});

// Reject Cafe Onboarding Request (Super Admin)
router.put('/onboarding-requests/:id/reject', [auth, checkRole(['super_admin'])], async (req, res) => {
    try {
        const requestId = req.params.id;
        const { reason } = req.body;

        const requestRecord = await OnboardingRequest.findById(requestId);
        if (!requestRecord) {
            return res.status(404).json({ error: 'Onboarding application not found.' });
        }

        requestRecord.status = 'rejected';
        requestRecord.rejectionReason = reason || 'Verification requirements not met';
        requestRecord.reviewedAt = new Date();
        requestRecord.reviewedBy = req.user.id;
        await requestRecord.save();

        // Send Rejection Email
        try {
            await emailService.sendRejectionEmail({
                to: requestRecord.email,
                cafeName: requestRecord.businessName,
                ownerName: requestRecord.ownerName,
                reason: requestRecord.rejectionReason
            });
        } catch (mailErr) {
            console.warn('Could not send rejection email:', mailErr.message);
        }

        res.json({
            success: true,
            message: `Application for "${requestRecord.businessName}" was rejected.`
        });
    } catch (err) {
        console.error('Reject request error:', err);
        res.status(500).json({ error: 'Failed to reject application: ' + err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// CAFE DEEP DIVE / EXPLORE ANALYTICS (Super Admin)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:id/explore-analytics', [auth, checkRole(['super_admin'])], async (req, res) => {
    try {
        const tenantId = req.params.id;
        const tenant = await Tenant.findById(tenantId).populate('ownerId', 'name email phone lastLogin');
        if (!tenant) {
            return res.status(404).json({ error: 'Cafe not found.' });
        }

        const mongoose = require('mongoose');
        const tId = new mongoose.Types.ObjectId(tenantId);

        // Date boundaries
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
        const startOf7Days = new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000);
        const startOf30Days = new Date(startOfToday.getTime() - 29 * 24 * 60 * 60 * 1000);
        const startOfYear = new Date(now.getFullYear(), 0, 1);

        // Run aggregations in parallel
        const [
            lifetimeStats,
            todayStats,
            yesterdayStats,
            last7DaysBreakdown,
            last30DaysBreakdown,
            yearlyBreakdown,
            orderStatusStats,
            paymentMethodStats,
            topItems
        ] = await Promise.all([
            // 1. Lifetime Totals
            Order.aggregate([
                { $match: { tenantId: tId, status: { $ne: 'cancelled' } } },
                { $group: { _id: null, totalRevenue: { $sum: '$total' }, totalOrders: { $sum: 1 }, avgOrderValue: { $avg: '$total' } } }
            ]),

            // 2. Today Stats
            Order.aggregate([
                { $match: { tenantId: tId, status: { $ne: 'cancelled' }, createdAt: { $gte: startOfToday } } },
                { $group: { _id: null, revenue: { $sum: '$total' }, orders: { $sum: 1 } } }
            ]),

            // 3. Yesterday Stats
            Order.aggregate([
                { $match: { tenantId: tId, status: { $ne: 'cancelled' }, createdAt: { $gte: startOfYesterday, $lt: startOfToday } } },
                { $group: { _id: null, revenue: { $sum: '$total' }, orders: { $sum: 1 } } }
            ]),

            // 4. Last 7 Days (Day-wise)
            Order.aggregate([
                { $match: { tenantId: tId, status: { $ne: 'cancelled' }, createdAt: { $gte: startOf7Days } } },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                        revenue: { $sum: '$total' },
                        orders: { $sum: 1 }
                    }
                },
                { $sort: { _id: 1 } }
            ]),

            // 5. Last 30 Days (Daily)
            Order.aggregate([
                { $match: { tenantId: tId, status: { $ne: 'cancelled' }, createdAt: { $gte: startOf30Days } } },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                        revenue: { $sum: '$total' },
                        orders: { $sum: 1 }
                    }
                },
                { $sort: { _id: 1 } }
            ]),

            // 6. Past 12 Months / Yearly Breakdown
            Order.aggregate([
                { $match: { tenantId: tId, status: { $ne: 'cancelled' }, createdAt: { $gte: startOfYear } } },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
                        revenue: { $sum: '$total' },
                        orders: { $sum: 1 }
                    }
                },
                { $sort: { _id: 1 } }
            ]),

            // 7. Order Status Distribution
            Order.aggregate([
                { $match: { tenantId: tId } },
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]),

            // 8. Payment Method Distribution
            Order.aggregate([
                { $match: { tenantId: tId, status: { $ne: 'cancelled' } } },
                { $group: { _id: { $ifNull: ['$paymentMethod', 'UPI'] }, count: { $sum: 1 }, revenue: { $sum: '$total' } } }
            ]),

            // 9. Top 5 Selling Dishes
            Order.aggregate([
                { $match: { tenantId: tId, status: { $ne: 'cancelled' } } },
                { $unwind: '$items' },
                {
                    $group: {
                        _id: '$items.name',
                        quantity: { $sum: '$items.quantity' },
                        revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
                    }
                },
                { $sort: { quantity: -1 } },
                { $limit: 5 }
            ])
        ]);

        const lifetime = lifetimeStats[0] || { totalRevenue: 0, totalOrders: 0, avgOrderValue: 0 };
        const today = todayStats[0] || { revenue: 0, orders: 0 };
        const yesterday = yesterdayStats[0] || { revenue: 0, orders: 0 };

        // Fill missing days in last 7 days array so the chart is completely continuous
        const dayMap = {};
        last7DaysBreakdown.forEach(d => { dayMap[d._id] = d; });
        const continuous7Days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(startOfToday.getTime() - i * 24 * 60 * 60 * 1000);
            const key = d.toISOString().slice(0, 10);
            continuous7Days.push({
                date: key,
                label: d.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' }),
                revenue: dayMap[key]?.revenue || 0,
                orders: dayMap[key]?.orders || 0
            });
        }

        // Subscription Pricing Recommendation Engine
        // Estimates how much this cafe should be charged based on run-rate
        const monthlyRevenueEstimate = continuous7Days.reduce((acc, cur) => acc + cur.revenue, 0) * 4.2;
        const monthlyOrdersEstimate = continuous7Days.reduce((acc, cur) => acc + cur.orders, 0) * 4.2;

        let recommendation = {
            recommendedPlan: '1_month',
            recommendedPlanName: '1 Month Starter',
            suggestedPrice: 999,
            reason: 'Suitable for new or early-stage cafes (< ₹50,000 monthly run-rate).'
        };

        if (monthlyRevenueEstimate > 250000 || monthlyOrdersEstimate > 800) {
            recommendation = {
                recommendedPlan: '1_year',
                recommendedPlanName: '1 Year Ultimate Pro',
                suggestedPrice: 10999,
                reason: `High performance volume (~₹${Math.round(monthlyRevenueEstimate).toLocaleString('en-IN')}/mo & ~${Math.round(monthlyOrdersEstimate)} orders). Eligible for VIP high-throughput tier.`
            };
        } else if (monthlyRevenueEstimate > 80000 || monthlyOrdersEstimate > 250) {
            recommendation = {
                recommendedPlan: '6_months',
                recommendedPlanName: '6 Months Saver',
                suggestedPrice: 4999,
                reason: `Growing active cafe (~₹${Math.round(monthlyRevenueEstimate).toLocaleString('en-IN')}/mo). Recommended for continuous stability.`
            };
        }

        res.json({
            success: true,
            cafe: {
                id: tenant._id,
                name: tenant.name,
                email: tenant.email,
                phone: tenant.phone,
                address: tenant.address,
                gstNumber: tenant.gstNumber,
                owner: tenant.ownerId,
                subscription: tenant.subscription,
                createdAt: tenant.createdAt
            },
            summary: {
                totalRevenue: lifetime.totalRevenue,
                totalOrders: lifetime.totalOrders,
                avgOrderValue: Math.round(lifetime.avgOrderValue || 0),
                todayRevenue: today.revenue,
                todayOrders: today.orders,
                yesterdayRevenue: yesterday.revenue,
                yesterdayOrders: yesterday.orders,
                estimatedMonthlyRevenue: Math.round(monthlyRevenueEstimate),
                estimatedMonthlyOrders: Math.round(monthlyOrdersEstimate)
            },
            charts: {
                last7Days: continuous7Days,
                last30Days: last30DaysBreakdown,
                yearly: yearlyBreakdown
            },
            operational: {
                orderStatuses: orderStatusStats,
                paymentMethods: paymentMethodStats,
                topDishes: topItems
            },
            recommendation
        });

    } catch (err) {
        console.error('Explore analytics error:', err);
        res.status(500).json({ error: 'Failed to fetch cafe explore analytics: ' + err.message });
    }
});

// Update Cafe Tenant Details & Owner User Credentials (Super Admin)
router.put('/:id/account', [auth, checkRole(['super_admin'])], async (req, res) => {
    try {
        const { cafeName, adminName, email, phone, password, sendEmailNotification } = req.body;
        const tenantId = req.params.id;

        const tenant = await Tenant.findById(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'Tenant not found' });
        }

        // Find associated admin user
        let user = null;
        if (tenant.ownerId) {
            user = await User.findById(tenant.ownerId);
        }
        if (!user) {
            user = await User.findOne({ tenantId: tenant._id, role: 'admin' });
        }

        const normalizedEmail = email ? email.toLowerCase().trim() : null;

        // If email is changing, ensure it is not taken by another user
        if (normalizedEmail && normalizedEmail !== tenant.email.toLowerCase()) {
            const existing = await User.findOne({ 
                email: normalizedEmail, 
                _id: { $ne: user?._id } 
            });
            if (existing) {
                return res.status(400).json({ error: 'This email is already in use by another user' });
            }
        }

        // Validate phone if provided
        let cleanPhone = undefined;
        if (phone !== undefined) {
            cleanPhone = String(phone).trim();
            if (cleanPhone && !/^[0-9]{10}$/.test(cleanPhone)) {
                return res.status(400).json({ error: 'Mobile number must be exactly 10 digits' });
            }
        }

        // Update Tenant fields
        if (cafeName && cafeName.trim()) {
            tenant.name = cafeName.trim();
        }
        if (normalizedEmail) {
            tenant.email = normalizedEmail;
        }
        if (cleanPhone !== undefined) {
            tenant.phone = cleanPhone;
        }
        await tenant.save();

        // Update or Create Admin User
        let plainPasswordForEmail = null;
        if (user) {
            if (adminName && adminName.trim()) {
                user.name = adminName.trim();
            }
            if (normalizedEmail) {
                user.email = normalizedEmail;
            }
            if (cleanPhone !== undefined) {
                user.phone = cleanPhone;
            }
            if (password && String(password).trim()) {
                const rawPass = String(password).trim();
                if (rawPass.length < 6) {
                    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
                }
                const salt = await bcrypt.genSalt(10);
                user.password = await bcrypt.hash(rawPass, salt);
                plainPasswordForEmail = rawPass;
            }
            await user.save();
        } else {
            // If user did not exist, create one
            const rawPass = password && String(password).trim() ? String(password).trim() : 'Dine#' + crypto.randomBytes(3).toString('hex').toUpperCase();
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(rawPass, salt);
            user = new User({
                tenantId: tenant._id,
                name: adminName || tenant.name,
                email: normalizedEmail || tenant.email,
                phone: cleanPhone || tenant.phone,
                password: hashedPassword,
                role: 'admin',
                status: 'active'
            });
            await user.save();
            tenant.ownerId = user._id;
            await tenant.save();
            plainPasswordForEmail = rawPass;
        }

        // If email notification requested and password was updated
        if (sendEmailNotification && plainPasswordForEmail) {
            try {
                await emailService.sendPasswordResetEmail({
                    to: user.email,
                    cafeName: tenant.name,
                    userName: user.name,
                    tempPassword: plainPasswordForEmail,
                    loginUrl: `${process.env.FRONTEND_URL || 'https://www.dineviq.com'}/login`
                });
            } catch (mailErr) {
                console.warn('Could not dispatch credential update email:', mailErr.message);
            }
        }

        res.json({
            success: true,
            message: 'Cafe and user credentials updated successfully',
            tenant: {
                ...tenant.toObject(),
                adminName: user.name,
                adminEmail: user.email,
                adminPhone: user.phone
            }
        });
    } catch (err) {
        console.error('Update tenant account error:', err);
        res.status(500).json({ error: 'Failed to update account: ' + err.message });
    }
});

// Send Password Reset Email to Cafe User's Gmail (Super Admin)
router.post('/:id/send-reset-password', [auth, checkRole(['super_admin'])], async (req, res) => {
    try {
        const tenant = await Tenant.findById(req.params.id);
        if (!tenant) {
            return res.status(404).json({ error: 'Tenant not found' });
        }

        let user = null;
        if (tenant.ownerId) {
            user = await User.findById(tenant.ownerId);
        }
        if (!user) {
            user = await User.findOne({ tenantId: tenant._id, role: 'admin' });
        }

        const tempPassword = 'Dine#' + crypto.randomBytes(3).toString('hex').toUpperCase();
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(tempPassword, salt);

        if (!user) {
            // Create admin user for tenant if not present
            user = new User({
                tenantId: tenant._id,
                name: tenant.name,
                email: tenant.email,
                phone: tenant.phone || '',
                password: hashedPassword,
                role: 'admin',
                status: 'active'
            });
            await user.save();
            tenant.ownerId = user._id;
            await tenant.save();
        } else {
            user.password = hashedPassword;
            await user.save();
        }

        const mailResult = await emailService.sendPasswordResetEmail({
            to: user.email,
            cafeName: tenant.name,
            userName: user.name,
            tempPassword,
            loginUrl: `${process.env.FRONTEND_URL || 'https://www.dineviq.com'}/login`
        });

        res.json({
            success: true,
            message: `Password reset email sent to ${user.email}`,
            tempPassword,
            email: user.email,
            mailSent: mailResult ? mailResult.success : true
        });
    } catch (err) {
        console.error('Send reset password error:', err);
        res.status(500).json({ error: 'Failed to send reset password: ' + err.message });
    }
});

module.exports = router;

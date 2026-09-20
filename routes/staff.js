const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const auth = require('../middleware/auth');

/**
 * @route   GET /api/staff
 * @desc    Get all staff members for the current tenant
 * @access  Private (Tenant Admin / Manager)
 */
router.get('/', auth, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const staff = await User.find({ tenantId, role: { $ne: 'super_admin' } })
            .select('-password')
            .sort({ createdAt: -1 });
        res.json(staff);
    } catch (err) {
        console.error('Fetch staff error:', err);
        res.status(500).json({ error: 'Failed to fetch staff members' });
    }
});

/**
 * @route   POST /api/staff
 * @desc    Create a new staff member with role & custom permissions
 * @access  Private (Tenant Admin)
 */
router.post('/', auth, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { name, email, password, role, permissions, status } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email/username, and password/PIN are required' });
        }

        const existing = await User.findOne({ email: email.toLowerCase() });
        if (existing) {
            return res.status(400).json({ error: 'A staff member or user with this email/username already exists' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newStaff = new User({
            tenantId,
            name: name.trim(),
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            role: role || 'staff',
            status: status || 'active',
            permissions: Array.isArray(permissions) ? permissions : ['access_pos', 'access_live_orders']
        });

        await newStaff.save();

        const staffData = newStaff.toObject();
        delete staffData.password;

        res.status(201).json({ success: true, message: `Staff member ${name} created successfully!`, staff: staffData });
    } catch (err) {
        console.error('Create staff error:', err);
        res.status(500).json({ error: 'Failed to create staff member: ' + err.message });
    }
});

/**
 * @route   PUT /api/staff/:id
 * @desc    Update staff member details, role, permissions, or status
 * @access  Private (Tenant Admin)
 */
router.put('/:id', auth, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { name, email, password, role, permissions, status } = req.body;

        const staff = await User.findOne({ _id: req.params.id, tenantId });
        if (!staff) return res.status(404).json({ error: 'Staff member not found' });

        if (name) staff.name = name.trim();
        if (email && email.toLowerCase() !== staff.email) {
            const dup = await User.findOne({ email: email.toLowerCase(), _id: { $ne: staff._id } });
            if (dup) return res.status(400).json({ error: 'Email/username is already in use by another account' });
            staff.email = email.toLowerCase().trim();
        }
        if (password) {
            const salt = await bcrypt.genSalt(10);
            staff.password = await bcrypt.hash(password, salt);
        }
        if (role) staff.role = role;
        if (status) staff.status = status;
        if (permissions) staff.permissions = permissions;

        await staff.save();

        const staffData = staff.toObject();
        delete staffData.password;

        res.json({ success: true, message: 'Staff member updated successfully', staff: staffData });
    } catch (err) {
        console.error('Update staff error:', err);
        res.status(500).json({ error: 'Failed to update staff member' });
    }
});

/**
 * @route   DELETE /api/staff/:id
 * @desc    Delete a staff member
 * @access  Private (Tenant Admin)
 */
router.delete('/:id', auth, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const staff = await User.findOneAndDelete({ _id: req.params.id, tenantId });
        if (!staff) return res.status(404).json({ error: 'Staff member not found' });

        res.json({ success: true, message: `Staff member ${staff.name} removed successfully` });
    } catch (err) {
        console.error('Delete staff error:', err);
        res.status(500).json({ error: 'Failed to delete staff member' });
    }
});

module.exports = router;

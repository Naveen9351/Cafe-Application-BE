const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const auth = require('../middleware/auth');

/**
 * Helper to normalize staff object for frontend
 */
function formatStaffOutput(staffDoc) {
    const obj = staffDoc.toObject ? staffDoc.toObject() : { ...staffDoc };
    delete obj.password;
    obj.fullName = obj.fullName || obj.name;
    obj.username = obj.username || obj.email;
    return obj;
}

/**
 * @route   GET /api/staff
 * @desc    Get all staff members for the current tenant
 * @access  Private (Tenant Admin / Manager)
 */
router.get('/', auth, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        // Do not return admin or super_admin in staff members list
        const staffList = await User.find({
            tenantId,
            role: { $nin: ['admin', 'super_admin'] }
        })
            .select('-password')
            .sort({ createdAt: -1 });

        const formatted = staffList.map(formatStaffOutput);
        res.json({ success: true, staff: formatted });
    } catch (err) {
        console.error('Fetch staff error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch staff members' });
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
        const name = (req.body.fullName || req.body.name || '').trim();
        const email = (req.body.username || req.body.email || '').toLowerCase().trim();
        const password = req.body.password;
        const phone = (req.body.phone || '').trim();
        const role = req.body.role || 'cashier';
        const permissions = req.body.permissions || {};
        const status = req.body.status || 'active';

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Full name, email/username, and password are required'
            });
        }

        const existing = await User.findOne({
            $or: [{ email }, { username: email }]
        });
        if (existing) {
            return res.status(400).json({
                success: false,
                error: 'A staff member or user with this email/username already exists'
            });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newStaff = new User({
            tenantId,
            name,
            fullName: name,
            email,
            username: email,
            phone,
            password: hashedPassword,
            role,
            status,
            permissions
        });

        await newStaff.save();

        const staffData = formatStaffOutput(newStaff);

        res.status(201).json({
            success: true,
            message: `Staff member ${name} created successfully!`,
            staff: staffData
        });
    } catch (err) {
        console.error('Create staff error:', err);
        res.status(500).json({ success: false, error: 'Failed to create staff member: ' + err.message });
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
        const name = (req.body.fullName || req.body.name || '').trim();
        const email = (req.body.username || req.body.email || '').toLowerCase().trim();
        const phone = req.body.phone;
        const password = req.body.password;
        const role = req.body.role;
        const permissions = req.body.permissions;
        const status = req.body.status;

        const staff = await User.findOne({ _id: req.params.id, tenantId });
        if (!staff) return res.status(404).json({ success: false, error: 'Staff member not found' });

        if (name) {
            staff.name = name;
            staff.fullName = name;
        }
        if (email && email !== staff.email) {
            const dup = await User.findOne({
                $or: [{ email }, { username: email }],
                _id: { $ne: staff._id }
            });
            if (dup) return res.status(400).json({ success: false, error: 'Email/username is already in use' });
            staff.email = email;
            staff.username = email;
        }
        if (phone !== undefined) staff.phone = phone.trim();
        if (password) {
            const salt = await bcrypt.genSalt(10);
            staff.password = await bcrypt.hash(password, salt);
        }
        if (role) staff.role = role;
        if (status) staff.status = status;
        if (permissions) staff.permissions = permissions;

        await staff.save();

        const staffData = formatStaffOutput(staff);

        res.json({
            success: true,
            message: 'Staff member updated successfully',
            staff: staffData
        });
    } catch (err) {
        console.error('Update staff error:', err);
        res.status(500).json({ success: false, error: 'Failed to update staff member' });
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
        const currentUserId = req.user.id || req.user._id?.toString();

        if (req.params.id === currentUserId) {
            return res.status(400).json({ success: false, error: 'You cannot delete your own account' });
        }

        const targetUser = await User.findOne({ _id: req.params.id, tenantId });
        if (!targetUser) return res.status(404).json({ success: false, error: 'Staff member not found' });

        if (targetUser.role === 'admin' || targetUser.role === 'super_admin') {
            return res.status(400).json({ success: false, error: 'Admin accounts cannot be deleted from staff management' });
        }

        await User.deleteOne({ _id: req.params.id });

        res.json({
            success: true,
            message: `Staff member ${targetUser.name || targetUser.fullName} removed successfully`
        });
    } catch (err) {
        console.error('Delete staff error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete staff member' });
    }
});

module.exports = router;

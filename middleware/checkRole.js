/**
 * Middleware to check if the user has one of the required roles or specific permission.
 * Usage: router.get('/protected', auth, checkRole(['admin', 'super_admin'], 'access_reports'), handler);
 */
module.exports = (roles = [], requiredPermKey = null) => {
    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Allow super_admin and admin to access
        if (req.user.role === 'super_admin' || req.user.role === 'admin') {
            return next();
        }

        if (roles.includes(req.user.role)) {
            return next();
        }

        // Check if user has explicit permission matching the required module/action
        let perms = req.user.permissions;
        if (!perms && req.user.id) {
            try {
                const User = require('../models/User');
                const u = await User.findById(req.user.id).select('permissions role').lean();
                if (u) perms = u.permissions;
            } catch (e) {}
        }

        if (requiredPermKey && perms && perms[requiredPermKey]) {
            return next();
        }

        // If user has any assigned staff permissions allowing this section
        if (perms && (perms.access_dashboard || perms.access_reports || perms.access_menu || perms.access_tables || perms.access_orders || perms.access_pos)) {
            if (!requiredPermKey) return next();
        }

        return res.status(403).json({
            error: `Access denied. Required role: ${roles.join(', ')}`
        });
    };
};

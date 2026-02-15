/**
 * Middleware to check if the user has one of the required roles.
 * Usage: router.get('/protected', auth, checkRole(['admin', 'super_admin']), handler);
 */
module.exports = (roles = []) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Allow super_admin to access everything if not explicitly restricted?
        // For now, strict role check.
        if (req.user.role === 'super_admin') {
            return next();
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                error: `Access denied. Required role: ${roles.join(', ')}`
            });
        }

        next();
    };
};

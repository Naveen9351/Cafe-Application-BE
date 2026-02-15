const Tenant = require('../models/Tenant');

module.exports = async (req, res, next) => {
    // Skip check for super_admin
    if (req.user && req.user.role === 'super_admin') {
        return next();
    }

    const tenantId = req.tenantId || req.user.tenantId;

    if (!tenantId) {
        return res.status(400).json({ error: 'Tenant context missing' });
    }

    try {
        const tenant = await Tenant.findById(tenantId);

        if (!tenant) {
            return res.status(404).json({ error: 'Tenant not found' });
        }

        if (!tenant.subscription.isActive) {
            return res.status(403).json({ error: 'Subscription is inactive. Please contact support.' });
        }

        if (tenant.subscription.endDate && new Date() > tenant.subscription.endDate) {
            return res.status(403).json({ error: 'Subscription expired. Please renew.' });
        }

        // Attach full tenant object if needed
        req.tenant = tenant;
        next();
    } catch (err) {
        console.error('Subscription check error:', err);
        res.status(500).json({ error: 'Server error checking subscription' });
    }
};

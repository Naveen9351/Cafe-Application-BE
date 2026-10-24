const Tenant = require('../models/Tenant');

// High-speed in-memory TTL cache for tenant subscription validation (60 seconds TTL)
const subscriptionCache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

function invalidateSubscriptionCache(tenantId) {
    if (tenantId) {
        subscriptionCache.delete(tenantId.toString());
    }
}

const checkSubscriptionMiddleware = async (req, res, next) => {
    // Skip check for super_admin
    if (req.user && req.user.role === 'super_admin') {
        return next();
    }

    const tenantId = req.tenantId || req.user?.tenantId;

    if (!tenantId) {
        return res.status(400).json({ error: 'Tenant context missing' });
    }

    const tenantKey = tenantId.toString();
    const cached = subscriptionCache.get(tenantKey);
    const now = Date.now();

    let tenantData;

    if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
        tenantData = cached.data;
    } else {
        try {
            const tenant = await Tenant.findById(tenantId)
                .select('subscription name logo settings')
                .lean();

            if (!tenant) {
                return res.status(404).json({ error: 'Tenant not found' });
            }

            tenantData = tenant;
            subscriptionCache.set(tenantKey, {
                timestamp: now,
                data: tenant
            });
        } catch (err) {
            console.error('Subscription check error:', err);
            return res.status(500).json({ error: 'Server error checking subscription' });
        }
    }

    if (!tenantData.subscription || !tenantData.subscription.isActive) {
        return res.status(403).json({ error: 'Subscription is inactive. Please contact support.' });
    }

    if (tenantData.subscription.endDate && new Date() > new Date(tenantData.subscription.endDate)) {
        return res.status(403).json({ error: 'Subscription expired. Please renew.' });
    }

    req.tenant = tenantData;
    next();
};

module.exports = checkSubscriptionMiddleware;
module.exports.invalidateSubscriptionCache = invalidateSubscriptionCache;


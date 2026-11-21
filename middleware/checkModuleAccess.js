const Tenant = require('../models/Tenant');
const { getEffectiveTenantModules, MODULE_DEFINITIONS } = require('../config/subscriptionPlans');

/**
 * Middleware factory to enforce that the tenant has subscribed to a specific module.
 *
 * @param {string|string[]} requiredModuleOrModules Single module ID or array (any match allows access)
 */
function checkModuleAccess(requiredModuleOrModules) {
  const requiredModules = Array.isArray(requiredModuleOrModules)
    ? requiredModuleOrModules
    : [requiredModuleOrModules];

  return async (req, res, next) => {
    try {
      // Super Admin bypasses all module restrictions
      if (req.user && req.user.role === 'super_admin') {
        return next();
      }

      const tenantId = req.tenantId || req.user?.tenantId || req.headers['x-tenant-id'] || req.body?.tenantId;

      if (!tenantId) {
        // Non-tenant contextual endpoint or public, pass through
        return next();
      }

      // Check if tenant object was already attached and has subscription
      let subscription = req.tenant?.subscription;

      if (!subscription) {
        const tenant = await Tenant.findById(tenantId).select('subscription').lean();
        if (!tenant) {
          return res.status(404).json({ error: 'Tenant not found' });
        }
        subscription = tenant.subscription || {};
      }

      // If subscription is marked inactive or expired, checkSubscription handles that.
      const effectiveModules = getEffectiveTenantModules(subscription);
      req.tenantModules = effectiveModules;

      // Check if any of the required modules is enabled
      const hasAccess = requiredModules.some(mod => effectiveModules.includes(mod));

      if (!hasAccess) {
        const modDef = MODULE_DEFINITIONS.find(m => m.id === requiredModules[0]);
        const moduleName = modDef?.name || requiredModules[0];

        return res.status(403).json({
          error: `Module locked: ${moduleName}`,
          code: 'MODULE_LOCKED',
          module: requiredModules[0],
          message: `Your current subscription does not include access to "${moduleName}". Please upgrade your plan or add this module.`
        });
      }

      next();
    } catch (err) {
      console.error('Module check error:', err);
      res.status(500).json({ error: 'Server error validating module access' });
    }
  };
}

module.exports = checkModuleAccess;

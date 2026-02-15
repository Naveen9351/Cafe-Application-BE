const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  // Get token from header
  const token = req.header('x-auth-token') || req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'No token, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, role, tenantId, ... }

    // Convenience for tenancy
    if (decoded.tenantId) {
      req.tenantId = decoded.tenantId;
    }

    next();
  } catch (err) {
    console.error('Auth error:', err.message);
    res.status(401).json({ error: 'Token is not valid' });
  }
};
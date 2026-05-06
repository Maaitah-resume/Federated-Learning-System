const Company = require('../models/Company');

async function authenticate(req, res, next) {
  try {
    const auth  = req.headers.authorization || req.headers.Authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;

    if (!token) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
    }

    // Demo token format: demo-token-<companyId>
    if (token.startsWith('demo-token-')) {
      const companyId = token.replace('demo-token-', '');
      const company   = await Company.findOne({ companyId });

      if (!company) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
      }

      // Attach full company info including role — required by adminOnly middleware
      req.company = {
        companyId:   company.companyId,
        companyName: company.companyName,
        email:       company.email,
        role:        company.role,      // ← THE FIX
        isActive:    company.isActive,
      };

      return next();
    }

    // For other tokens, deny in this lightweight test harness
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticate };

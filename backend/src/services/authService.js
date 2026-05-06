const Company = require('../models/Company');

/**
 * Login using email or companyId + password.
 * Looks up user from MongoDB — works for ANY user added via admin panel.
 */
async function login(email, password) {
  if (!email || !password) {
    const err = new Error('Email and password are required');
    err.statusCode = 400;
    throw err;
  }

  // Find by email (case-insensitive) or companyId
  const company = await Company.findOne({
    $or: [
      { email: email.toLowerCase().trim() },
      { companyId: email.toLowerCase().trim() },
    ],
  });

  if (!company) {
    const err = new Error('Invalid email or password.');
    err.statusCode = 401;
    throw err;
  }

  if (!company.isActive) {
    const err = new Error('Account is disabled. Contact the administrator.');
    err.statusCode = 403;
    throw err;
  }

  // Plain-text password check (demo mode)
  if (company.passwordHash !== password) {
    const err = new Error('Invalid email or password.');
    err.statusCode = 401;
    throw err;
  }

  // Update last login timestamp
  company.lastLoginAt = new Date();
  await company.save();

  const token = `demo-token-${company.companyId}`;
  return { token, company };
}

async function getCompanyById(companyId) {
  return Company.findOne({ companyId });
}

module.exports = { login, getCompanyById };

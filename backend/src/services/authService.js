const Company = require('../models/Company');

// Fixed list of allowed demo users - no auto-create
const DEMO_USERS = [
  {
    companyId:    'alpha',
    companyName:  'Alpha Corporation',
    email:        'alpha@demo.com',
    passwordHash: 'demo123',
    role:         'client',
    isActive:     true,
  },
  {
    companyId:    'beta',
    companyName:  'Beta Industries',
    email:        'beta@demo.com',
    passwordHash: 'demo123',
    role:         'client',
    isActive:     true,
  },
  {
    companyId:    'gamma',
    companyName:  'Gamma Systems',
    email:        'gamma@demo.com',
    passwordHash: 'demo123',
    role:         'client',
    isActive:     true,
  },
];

// Seed demo users on first load (idempotent - safe to run many times)
async function ensureDemoUsers() {
  for (const userData of DEMO_USERS) {
    const existing = await Company.findOne({ companyId: userData.companyId });
    if (!existing) {
      try {
        await Company.create(userData);
        console.log(`✅ Seeded demo user: ${userData.companyId}`);
      } catch (err) {
        // Ignore duplicate key errors from concurrent seed attempts
        if (err.code !== 11000) console.error(`Seed error for ${userData.companyId}:`, err.message);
      }
    }
  }
}

async function login(email, password) {
  // Make sure demo users exist on every login attempt
  await ensureDemoUsers();

  // Find by email or companyId (so 'alpha' or 'alpha@demo.com' both work)
  const company = await Company.findOne({
    $or: [{ email: email.toLowerCase() }, { companyId: email.toLowerCase() }],
  });

  if (!company) {
    const err = new Error('Invalid credentials. Try: alpha, beta, or gamma');
    err.statusCode = 401;
    throw err;
  }

  // Check password (plain text for demo)
  if (company.passwordHash !== password) {
    const err = new Error('Invalid password. Use: demo123');
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

module.exports = { login, getCompanyById, ensureDemoUsers, DEMO_USERS };

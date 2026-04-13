const Company = require('../models/Company');

async function login(email, password) {
  // Demo-mode login: find by email or companyId, create if missing
  const lookup = await Company.findOne({ $or: [{ email }, { companyId: email }] });
  let company = lookup;
  if (!company) {
    const companyId = email.split('@')[0];
    company = await Company.create({
      companyId,
      companyName: companyId,
      email,
      passwordHash: 'demo',
      role: 'client',
      isActive: true,
    });
  }

  const token = `demo-token-${company.companyId}`;
  return { token, company };
}

async function getCompanyById(companyId) {
  return Company.findOne({ companyId });
}

module.exports = { login, getCompanyById };

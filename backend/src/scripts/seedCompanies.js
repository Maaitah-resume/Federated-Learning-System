// src/scripts/seedCompanies.js
// Run: node src/scripts/seedCompanies.js
// Creates the demo companies needed for local development and testing.

require('dotenv').config();
const { connectDB }  = require('../config/db');
const Company        = require('../models/Company');

const DEMO_COMPANIES = [
  {
    companyId:    'alpha',
    companyName:  'Alpha Corp',
    email:        'alpha@demo.com',
    passwordHash: 'demo',
    role:         'client',
    isActive:     true,
    metadata: { contactPerson: 'Alice Smith', networkSegment: 'finance' },
  },
  {
    companyId:    'beta',
    companyName:  'Beta Ltd',
    email:        'beta@demo.com',
    passwordHash: 'demo',
    role:         'client',
    isActive:     true,
    metadata: { contactPerson: 'Bob Jones', networkSegment: 'healthcare' },
  },
  {
    companyId:    'gamma',
    companyName:  'Gamma Inc',
    email:        'gamma@demo.com',
    passwordHash: 'demo',
    role:         'client',
    isActive:     true,
    metadata: { contactPerson: 'Carol White', networkSegment: 'logistics' },
  },
  {
    companyId:    'admin',
    companyName:  'Admin',
    email:        'admin@demo.com',
    passwordHash: 'demo',
    role:         'admin',
    isActive:     true,
  },
];

async function seed() {
  await connectDB();

  console.log('\nSeeding demo companies...\n');

  for (const data of DEMO_COMPANIES) {
    const existing = await Company.findOne({ companyId: data.companyId });

    if (existing) {
      console.log(`  skip   ${data.companyId} (already exists)`);
      continue;
    }

    await Company.create(data);
    console.log(`  created ${data.companyId} — token: demo-token-${data.companyId}`);
  }

  console.log('\nDone. Use these tokens in Authorization headers:');
  DEMO_COMPANIES.forEach((c) => {
    console.log(`  ${c.companyId.padEnd(8)} →  Bearer demo-token-${c.companyId}`);
  });
  console.log('');

  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
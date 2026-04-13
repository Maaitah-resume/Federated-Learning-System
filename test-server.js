const express = require('./backend/node_modules/express');
const cors = require('./backend/node_modules/cors');

const app = express();
app.use(cors());
app.use(express.json());

const companies = new Map();
const queue = [];

function ensureDemoCompanies() {
  const demo = [
    { companyId: 'alpha', companyName: 'Alpha Corp', email: 'alpha@demo.com' },
    { companyId: 'beta',  companyName: 'Beta Ltd',   email: 'beta@demo.com' },
    { companyId: 'gamma', companyName: 'Gamma Inc',  email: 'gamma@demo.com' },
  ];
  const seeded = [];
  for (const c of demo) {
    if (!companies.has(c.companyId)) {
      companies.set(c.companyId, { ...c, passwordHash: 'demo', isActive: true });
      seeded.push(`created: ${c.companyId}`);
    } else {
      seeded.push(`exists:  ${c.companyId}`);
    }
  }
  return seeded;
}

app.post('/api/demo/seed', (req, res) => {
  const seeded = ensureDemoCompanies();
  return res.json({ seeded });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  const company = Array.from(companies.values()).find(c => c.email === email || c.companyId === email);
  if (!company) return res.status(404).json({ error: 'not found' });
  const token = `demo-token-${company.companyId}`;
  return res.json({ token, company });
});

app.get('/api/auth/me', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (!token) return res.status(401).json({ error: 'missing token' });
  if (token.startsWith('demo-token-')) {
    const companyId = token.replace('demo-token-', '');
    const company = companies.get(companyId);
    if (!company) return res.status(401).json({ error: 'invalid token' });
    return res.json({ company: { id: company.companyId } });
  }
  return res.status(401).json({ error: 'invalid token' });
});

app.get('/api/queue', (req, res) => {
  res.json({ count: queue.length, minRequired: 3 });
});

app.post('/api/queue/join', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (!token || !token.startsWith('demo-token-')) return res.status(401).json({ error: 'unauthorized' });
  const companyId = token.replace('demo-token-', '');
  if (queue.includes(companyId)) return res.status(409).json({ error: { code: 'ALREADY_QUEUED' } });
  queue.push(companyId);
  return res.json({ joined: true, position: queue.length });
});

app.post('/api/queue/leave', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (!token || !token.startsWith('demo-token-')) return res.status(401).json({ error: 'unauthorized' });
  const companyId = token.replace('demo-token-', '');
  const idx = queue.indexOf(companyId);
  if (idx !== -1) queue.splice(idx, 1);
  return res.json({ left: true });
});

app.get('/api/training/history', (req, res) => {
  res.json([]);
});

app.get('/api/models', (req, res) => {
  res.json([]);
});

app.post('/api/v1/auth/login', (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username required' });
  const token = `demo-token-${username}`;
  return res.json({ status: 'success', data: { token } });
});

const server = app.listen(4000, '0.0.0.0', () => {
  console.log('Test server running on http://localhost:4000');
});

module.exports = server;

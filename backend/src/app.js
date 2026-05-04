// src/app.js
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const path       = require('path');

const { apiLimiter, loginLimiter } = require('./middleware/rateLimiter');
const errorHandler                 = require('./middleware/errorHandler');

// ── Route modules ─────────────────────────────────────────────────────────────
const authRoutes     = require('./routes/auth.routes');
const queueRoutes    = require('./routes/queue.routes');
const dataRoutes     = require('./routes/data.routes');
const metricsRoutes  = require('./routes/metrics.routes');
const trainingRoutes = require('./routes/training.routes');
const modelRoutes    = require('./routes/model.routes');
const healthRoutes   = require('./routes/health.routes');

const app = express();

// ── Security & logging ────────────────────────────────────────────────────────
app.use(
  helmet({
    // Relax CSP so the React frontend can load from the same origin
    contentSecurityPolicy: false,
  })
);
app.use(cors({ origin: '*' }));   // tighten to your frontend URL in production
app.use(morgan('dev'));            // HTTP request log: "GET /api/auth/me 200 5ms"

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));        // model weights can be large
app.use(express.urlencoded({ extended: false }));

// ── Serve React frontend (static build) ───────────────────────────────────────
// In development the React dev server runs separately on port 5173.
// In production (Docker), `npm run build` outputs to /app/frontend/dist
// and Express serves it here.
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDist));

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/health',          healthRoutes);
app.use('/api/auth',        loginLimiter, authRoutes);
app.use('/api/queue',       apiLimiter,   queueRoutes);
app.use('/api/data',        apiLimiter,   dataRoutes);
app.use('/api/metrics',     apiLimiter,   metricsRoutes);
app.use('/api/training',    apiLimiter,   trainingRoutes);
app.use('/api/models',      apiLimiter,   modelRoutes);

// ── Demo seed data ────────────────────────────────────────────────────────────
// DEMO MODE: exposes a helper endpoint to create test companies without
// needing to run a separate seed script. Remove this in production.
const Company = require('./models/Company');

app.post('/api/demo/seed', async (req, res) => {
  try {
    const demoCompanies = [
      { companyId: 'alpha',   companyName: 'Alpha Corp',   email: 'alpha@demo.com',   passwordHash: 'demo', role: 'client' },
      { companyId: 'beta',    companyName: 'Beta Ltd',     email: 'beta@demo.com',    passwordHash: 'demo', role: 'client' },
      { companyId: 'gamma',   companyName: 'Gamma Inc',    email: 'gamma@demo.com',   passwordHash: 'demo', role: 'client' },
    ];

    const results = [];
    for (const c of demoCompanies) {
      const existing = await Company.findOne({ companyId: c.companyId });
      if (!existing) {
        await Company.create(c);
        results.push(`created: ${c.companyId}`);
      } else {
        results.push(`exists:  ${c.companyId}`);
      }
    }

    return res.status(200).json({ seeded: results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Demo login endpoint (matches frontend format) ─────────────────────────────
// The uploaded frontend calls POST /api/v1/auth/login with { username, password }
// This demo endpoint accepts any username and returns a demo token.
app.post('/api/v1/auth/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username) {
    return res.status(400).json({ status: 'error', detail: 'Username required' });
  }

  // Find company by companyId or email
  let company = await Company.findOne({
    $or: [{ companyId: username }, { email: username }],
    isActive: true,
  });

  // Demo mode: auto-create the company if it doesn't exist
  if (!company) {
    company = await Company.create({
      companyId:    username,
      companyName:  username,
      email:        `${username}@demo.com`,
      passwordHash: 'demo',
      role:         'client',
    });
  }

  return res.status(200).json({
    status: 'success',
    data: {
      user_id:  company.companyId,
      username: company.companyName,
      email:    company.email,
      token:    `demo-token-${company.companyId}`,
    },
  });
});

// Demo register (mirrors frontend Register.jsx)
app.post('/api/v1/auth/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email) {
    return res.status(400).json({ status: 'error', detail: 'Username and email required' });
  }

  try {
    const company = await Company.create({
      companyId:    username,
      companyName:  username,
      email:        email,
      passwordHash: 'demo',
      role:         'client',
    });

    return res.status(200).json({
      status: 'success',
      data: {
        user_id:  company.companyId,
        username: company.companyName,
        email:    company.email,
      },
    });
  } catch (err) {
    return res.status(409).json({ status: 'error', detail: 'Username or email already exists' });
  }
});

// ── Catch-all: serve React app for all non-API routes ─────────────────────────
// This makes client-side routing (React Router) work when the user
// refreshes a page or navigates directly to /queue, /training, etc.
app.get('*', (req, res, next) => {
  // Don't catch API routes — let them fall through to 404
  if (req.path.startsWith('/api/') || req.path.startsWith('/health')) {
    return next();
  }
  res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
    if (err) {
      // Frontend not built yet — return a helpful message in development
      res.status(200).json({
        message:  'FL-IDS Backend is running.',
        frontend: 'Run `npm run build` in the frontend folder to serve the UI here.',
        api:      'API is available at /api/*',
        health:   '/health',
      });
    }
  });
});

// ── Central error handler (must be last) ──────────────────────────────────────
app.use(errorHandler);

module.exports = app;

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
    contentSecurityPolicy: false,
  })
);
app.use(cors({ origin: '*' }));
app.use(morgan('dev'));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false }));

// ── Serve React frontend (static build) ───────────────────────────────────────
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDist));

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/health',       healthRoutes);
app.use('/api/auth',     loginLimiter, authRoutes);
app.use('/api/queue',    apiLimiter,   queueRoutes);
app.use('/api/data',     apiLimiter,   dataRoutes);
app.use('/api/metrics',  apiLimiter,   metricsRoutes);
app.use('/api/training', apiLimiter,   trainingRoutes);
app.use('/api/models',   apiLimiter,   modelRoutes);

// ── Demo seed data ────────────────────────────────────────────────────────────
const Company = require('./models/Company');

app.post('/api/demo/seed', async (req, res) => {
  try {
    const demoCompanies = [
      { companyId: 'mohammad', companyName: 'Mohammad HTU', email: 'Mohammad@htu.edu.jo', passwordHash: '123', role: 'client' },
      { companyId: 'amer',     companyName: 'Amer HTU',     email: 'Amer@htu.edu.jo',     passwordHash: '123', role: 'client' },
      { companyId: 'ammar',    companyName: 'Ammar HTU',    email: 'Ammar@htu.edu.jo',    passwordHash: '123', role: 'client' },
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

// ── Catch-all: serve React app for all non-API routes ─────────────────────────
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/health')) {
    return next();
  }
  res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
    if (err) {
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

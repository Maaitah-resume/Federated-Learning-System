// src/routes/health.routes.js
const express       = require('express');
const { getConnectionStatus } = require('../config/db');
const pythonBridge  = require('../services/pythonBridge');

const router = express.Router();

// GET /health
router.get('/', async (req, res) => {
  const dbStatus = getConnectionStatus();
  const pyHealth = await pythonBridge.healthCheck();
  const healthy  = dbStatus === 'connected' && pyHealth !== null;

  return res.status(healthy ? 200 : 503).json({
    status:        healthy ? 'ok' : 'degraded',
    db:            dbStatus,
    pythonService: pyHealth ? 'reachable' : 'unreachable',
    timestamp:     new Date().toISOString(),
  });
});

module.exports = router;
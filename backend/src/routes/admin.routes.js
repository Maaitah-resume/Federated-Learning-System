// backend/src/routes/admin.routes.js
const express  = require('express');
const Company  = require('../models/Company');
const TrainingMetric = require('../models/TrainingMetric');
const Model    = require('../models/Models');
const { authenticate } = require('../middleware/authMiddleware');
const { getConfig, setConfig, getAllConfig } = require('../models/SystemConfig');

const router = express.Router();

// ── Admin-only middleware ──────────────────────────────────────────────────────
function adminOnly(req, res, next) {
  if (req.company?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ── GET /api/admin/config ─────────────────────────────────────────────────────
router.get('/config', authenticate, adminOnly, async (req, res, next) => {
  try {
    const config = await getAllConfig();
    return res.status(200).json(config);
  } catch (err) { next(err); }
});

// ── PUT /api/admin/config ─────────────────────────────────────────────────────
router.put('/config', authenticate, adminOnly, async (req, res, next) => {
  try {
    const { MIN_CLIENTS, DEFAULT_ROUNDS, LEARNING_RATE } = req.body;
    const adminId = req.company.companyId;

    if (MIN_CLIENTS !== undefined) {
      const val = parseInt(MIN_CLIENTS);
      if (isNaN(val) || val < 2 || val > 10) {
        return res.status(400).json({ error: 'MIN_CLIENTS must be between 2 and 10' });
      }
      await setConfig('MIN_CLIENTS', val, adminId);
    }

    if (DEFAULT_ROUNDS !== undefined) {
      const val = parseInt(DEFAULT_ROUNDS);
      if (isNaN(val) || val < 1 || val > 50) {
        return res.status(400).json({ error: 'DEFAULT_ROUNDS must be between 1 and 50' });
      }
      await setConfig('DEFAULT_ROUNDS', val, adminId);
    }

    if (LEARNING_RATE !== undefined) {
      const val = parseFloat(LEARNING_RATE);
      if (isNaN(val) || val <= 0 || val > 1) {
        return res.status(400).json({ error: 'LEARNING_RATE must be between 0 and 1' });
      }
      await setConfig('LEARNING_RATE', val, adminId);
    }

    const updated = await getAllConfig();
    return res.status(200).json({ saved: true, config: updated });
  } catch (err) { next(err); }
});

// ── GET /api/admin/users ──────────────────────────────────────────────────────
router.get('/users', authenticate, adminOnly, async (req, res, next) => {
  try {
    const users = await Company.find({}).select('-passwordHash -apiKey');
    return res.status(200).json(users.map((u) => ({
      companyId:   u.companyId,
      companyName: u.companyName,
      email:       u.email,
      role:        u.role,
      isActive:    u.isActive,
      createdAt:   u.createdAt,
    })));
  } catch (err) { next(err); }
});

// ── POST /api/admin/users — add a new user ────────────────────────────────────
router.post('/users', authenticate, adminOnly, async (req, res, next) => {
  try {
    const { companyId, companyName, email, password, role } = req.body;

    if (!companyId || !companyName || !email || !password) {
      return res.status(400).json({ error: 'companyId, companyName, email and password are required' });
    }

    const existing = await Company.findOne({ $or: [{ companyId }, { email }] });
    if (existing) {
      return res.status(409).json({ error: 'User with this ID or email already exists' });
    }

    const user = await Company.create({
      companyId,
      companyName,
      email:        email.toLowerCase(),
      passwordHash: password,  // plain for demo; hash in production
      role:         role === 'admin' ? 'admin' : 'client',
      isActive:     true,
    });

    return res.status(201).json({
      created: true,
      user: {
        companyId:   user.companyId,
        companyName: user.companyName,
        email:       user.email,
        role:        user.role,
      },
    });
  } catch (err) { next(err); }
});

// ── DELETE /api/admin/users/:companyId ────────────────────────────────────────
router.delete('/users/:companyId', authenticate, adminOnly, async (req, res, next) => {
  try {
    const { companyId } = req.params;

    if (companyId === req.company.companyId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    await Company.deleteOne({ companyId });
    return res.status(200).json({ deleted: true, companyId });
  } catch (err) { next(err); }
});

// ── GET /api/admin/stats ──────────────────────────────────────────────────────
router.get('/stats', authenticate, adminOnly, async (req, res, next) => {
  try {
    const [totalUsers, totalModels, totalRounds, config] = await Promise.all([
      Company.countDocuments({ role: 'client' }),
      Model.countDocuments({ status: 'AVAILABLE' }),
      TrainingMetric.distinct('jobId', { type: 'global' }),
      getAllConfig(),
    ]);

    return res.status(200).json({
      totalUsers,
      totalModels,
      totalJobs: totalRounds.length,
      config,
    });
  } catch (err) { next(err); }
});

module.exports = router;

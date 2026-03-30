// src/routes/auth.routes.js
const express      = require('express');
const bcrypt       = require('bcryptjs');
const authService  = require('../services/authService');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// POST /auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Email and password are required' },
      });
    }

    const { token, company } = await authService.login(email, password);

    return res.status(200).json({ token, company });
  } catch (err) {
    next(err);
  }
});

// POST /auth/logout
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    // Token is stateless (JWT) — client discards it.
    // Extend here with a deny-list if needed.
    return res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
});

// GET /auth/me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const company = await authService.getCompanyById(req.company.companyId);
    return res.status(200).json({ company: company.toSafeJSON() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
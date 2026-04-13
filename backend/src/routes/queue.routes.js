// src/routes/queue.routes.js
const express      = require('express');
const queueService = require('../services/queueService');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/queue
router.get('/', authenticate, async (req, res, next) => {
  try {
    const jobManager = require('../services/jobManager');
    const state      = await queueService.getQueueState();
    const activeJob  = await jobManager.getActiveJob();
    return res.status(200).json({
      ...state,
      activeJob: activeJob
        ? { jobId: activeJob.jobId, status: activeJob.status }
        : null,
    });
  } catch (err) { next(err); }
});

// POST /api/queue/join
router.post('/join', authenticate, async (req, res, next) => {
  try {
    const state = await queueService.joinQueue(req.company.companyId);
    return res.status(200).json({ joined: true, position: state.count, queueState: state });
  } catch (err) { next(err); }
});

// POST /api/queue/leave
router.post('/leave', authenticate, async (req, res, next) => {
  try {
    await queueService.leaveQueue(req.company.companyId);
    return res.status(200).json({ left: true });
  } catch (err) { next(err); }
});

module.exports = router;
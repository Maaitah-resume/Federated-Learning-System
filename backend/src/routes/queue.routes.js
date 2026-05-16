// backend/src/routes/queue.routes.js
//
// FIX: Pass req.company.companyId to queueService.getQueueState() so each
// user receives only their own room's participants, not the global pool.
// This is the companion change to the multi-room fix in queueService.js.
//
const express      = require('express');
const queueService = require('../services/queueService');
const fedOrch      = require('../services/federatedOrchestrator');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/queue — queue state scoped to the requesting user's room
router.get('/', authenticate, async (req, res, next) => {
  try {
    // Pass companyId so getQueueState returns only this user's room
    const state  = await queueService.getQueueState(req.company.companyId);
    const rawJob = fedOrch.getActiveJob();

    return res.status(200).json({
      ...state,
      activeJob: rawJob
        ? {
            jobId:        rawJob.jobId,
            status:       rawJob.status,
            currentRound: rawJob.currentRound || 0,
            totalRounds:  rawJob.totalRounds  || 5,
          }
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

// backend/src/routes/queue.routes.js
//
// FIX 1 (multi-room): Pass req.company.companyId to queueService.getQueueState()
// so each user receives only their own room's participants.
//
// FIX 2 (job leakage): Only include activeJob in the response if the requesting
// user is actually a participant in it.  Previously fedOrch.getActiveJob() was
// returned to EVERY authenticated request, so Ammar polling GET /api/queue
// while Mohammad+Amer were training received the live job object and the
// frontend rendered the full training UI — "Training Active", round progress
// bar, "Training Nodes", etc. — even though Ammar was in a different room.
//
const express      = require('express');
const queueService = require('../services/queueService');
const fedOrch      = require('../services/federatedOrchestrator');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/queue — queue state scoped to the requesting user's room
router.get('/', authenticate, async (req, res, next) => {
  try {
    const companyId = req.company.companyId;

    // Room-scoped participant list
    const state = await queueService.getQueueState(companyId);

    // ── Job visibility check ──────────────────────────────────────────────────
    // Only expose the active job to its own participants.
    // Anyone else (different room, not yet queued, just browsing) receives
    // activeJob: null so the frontend shows them the normal idle waiting room
    // with no training metrics, no progress bar, no round counter.
    const rawJob = fedOrch.getActiveJob();
    const isParticipant = rawJob && rawJob.participantIds.includes(companyId);

    return res.status(200).json({
      ...state,
      activeJob: isParticipant
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

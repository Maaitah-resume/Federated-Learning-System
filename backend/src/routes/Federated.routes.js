/**
 * federated.routes.js
 * Place at: backend/src/routes/federated.routes.js
 */

const express  = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const fedOrch  = require('../services/federatedOrchestrator');

const router = express.Router();

// ─── GET /api/federated/weights ───────────────────────────────────────────────
/**
 * Returns the current global model weights PLUS the adaptive weights for the
 * current round.
 *
 * FIX: added adaptiveWeights to the response so that the client-side polling
 * recovery loop (which polls /api/federated/weights every 5 s to detect missed
 * round:started events) can pass the correct α to runLocalRound without having
 * to fall back to uniform scaling.
 *
 * Round 1  → { hasWeights: false, adaptiveWeights: {...} }
 * Round 2+ → { hasWeights: true, weights, adaptiveWeights: {...} }
 */
router.get('/weights', authenticate, (req, res) => {
  const activeJob     = fedOrch.getActiveJob();
  const globalWeights = fedOrch.getGlobalWeights();

  if (!activeJob) return res.status(404).json({ error: 'No active training job' });

  if (!globalWeights) {
    return res.status(200).json({
      hasWeights:      false,
      jobId:           activeJob.jobId,
      currentRound:    activeJob.currentRound,
      totalRounds:     activeJob.totalRounds,
      adaptiveWeights: activeJob.adaptiveWeights || null,
    });
  }

  return res.status(200).json({
    hasWeights:      true,
    jobId:           activeJob.jobId,
    currentRound:    activeJob.currentRound,
    totalRounds:     activeJob.totalRounds,
    weights:         globalWeights,
    adaptiveWeights: activeJob.adaptiveWeights || null,
  });
});

// ─── GET /api/federated/masks ─────────────────────────────────────────────────
router.get('/masks', authenticate, (req, res) => {
  const companyId = req.company.companyId;
  const activeJob = fedOrch.getActiveJob();

  if (!activeJob) return res.status(404).json({ error: 'No active training job' });

  const assignments = fedOrch.getMasksForNode(companyId);

  if (!assignments) {
    return res.status(403).json({ error: 'This node is not part of the active job' });
  }

  return res.status(200).json({
    jobId:       activeJob.jobId,
    round:       activeJob.currentRound,
    assignments,
  });
});

// ─── POST /api/federated/submit ───────────────────────────────────────────────
router.post('/submit', authenticate, (req, res) => {
  const companyId = req.company.companyId;
  const { jobId, round, maskedWeights, metrics } = req.body;

  if (!jobId || round == null || !maskedWeights) {
    return res.status(400).json({ error: 'Missing jobId, round, or maskedWeights' });
  }

  if (!maskedWeights.shapes || !maskedWeights.values) {
    return res.status(400).json({ error: 'Invalid maskedWeights format — expected { shapes, values }' });
  }

  const result = fedOrch.submitWeights(companyId, { maskedWeights, metrics, round, jobId });

  if (!result.accepted) {
    return res.status(409).json({ error: result.reason });
  }

  return res.status(200).json({
    accepted:  true,
    received:  result.received,
    expected:  result.expected,
    companyId,
    round,
  });
});

module.exports = router;

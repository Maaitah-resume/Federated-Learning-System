/**
 * Federated.routes.js
 * backend/src/routes/Federated.routes.js
 *
 * ── FIX: Job membership check on /weights ────────────────────────────────────
 * Previously GET /api/federated/weights returned the current round data to
 * ANY authenticated user, whether or not they were in the active job.
 * This caused Ammar's browser to see Mohammad+Amer's training round via the
 * 5-second polling safety net, trigger runLocalRound, and show "Round N is
 * waiting!" even though Ammar was never part of that job.
 *
 * Fix: check that req.company.companyId is in activeJob.participantIds.
 * Non-participants get 404 (same as "no active job"), so their poll loop
 * stays quiet and they see only their own idle waiting room.
 *
 * The /masks and /submit endpoints already had this guard (getMasksForNode
 * returns null for non-participants → 403).  We align /weights to the same
 * membership semantics.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const express  = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const fedOrch  = require('../services/federatedOrchestrator');

const router = express.Router();

// ─── GET /api/federated/weights ───────────────────────────────────────────────
router.get('/weights', authenticate, (req, res) => {
  const activeJob     = fedOrch.getActiveJob();
  const globalWeights = fedOrch.getGlobalWeights();
  const companyId     = req.company.companyId;

  if (!activeJob) return res.status(404).json({ error: 'No active training job' });

  // ── Membership check ────────────────────────────────────────────────────────
  // Only participants of the active job may poll for weights.
  // Users in a different waiting room (or not queued at all) receive 404 so
  // their 5-second poll loop treats this the same as "no job running" and
  // does not attempt to train.
  if (!activeJob.participantIds.includes(companyId)) {
    return res.status(404).json({ error: 'No active training job for this node' });
  }

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

/**
 * Federated.routes.js
 * backend/src/routes/Federated.routes.js
 *
 * ── FIX: alreadySubmitted flag on /weights ────────────────────────────────────
 * After a page reconnect/refresh, the client's lastSubmittedRoundRef resets to 0.
 * If the server is still on round N waiting for remaining nodes, the guard
 *   `if (data.round <= lastSubmittedRoundRef.current)` → `N <= 0` → false
 * should let the client retrain — BUT if this client already submitted for
 * round N in a previous socket session, pendingSubmissions already has their
 * entry, and a second submitWeights() call gets rejected with 409 ("Wrong round"
 * or duplicate), which Queue.tsx silently swallows.  The client then stays in
 * 'waiting' phase but the server's received count never reaches expected.
 *
 * REAL BUG (confirmed in logs): amer submits round 1, reconnects, gets
 * round:started replayed with data.round=1, but lastSubmittedRoundRef=1 from
 * the successful prior submission — so the guard fires and returns early.
 * The 5-second poll also hits `currentRound(1) > lastSubmitted(1)` → false.
 * Amer is permanently stuck. Mohammad+ammar keep resubmitting (server dedupes
 * them at 2/3) but arer never reaches 3/3.
 *
 * FIX: /weights now returns `alreadySubmitted: bool` — true when this specific
 * companyId already has an entry in pendingSubmissions for the current round.
 * Queue.tsx uses this flag to sync lastSubmittedRoundRef on reconnect:
 *   - alreadySubmitted=true  → set lastSubmitted = currentRound (already done,
 *                              don't retrain, wait for round:aggregated)
 *   - alreadySubmitted=false → if currentRound > lastSubmitted, trigger training
 *
 * ── Prior fix: Job membership check on /weights ───────────────────────────────
 * Non-participants get 404 so their poll loop stays quiet.
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
  if (!activeJob.participantIds.includes(companyId)) {
    return res.status(404).json({ error: 'No active training job for this node' });
  }

  // ── Has this node already submitted for the current round? ──────────────────
  // Exposed so the client can sync lastSubmittedRoundRef after a reconnect.
  const alreadySubmitted = fedOrch.hasSubmittedForRound(companyId);

  if (!globalWeights) {
    return res.status(200).json({
      hasWeights:       false,
      jobId:            activeJob.jobId,
      currentRound:     activeJob.currentRound,
      totalRounds:      activeJob.totalRounds,
      adaptiveWeights:  activeJob.adaptiveWeights || null,
      alreadySubmitted,
    });
  }

  return res.status(200).json({
    hasWeights:       true,
    jobId:            activeJob.jobId,
    currentRound:     activeJob.currentRound,
    totalRounds:      activeJob.totalRounds,
    weights:          globalWeights,
    adaptiveWeights:  activeJob.adaptiveWeights || null,
    alreadySubmitted,
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

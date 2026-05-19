/**
 * Federated.routes.js
 * backend/src/routes/Federated.routes.js
 *
 * Fixes applied:
 *
 * 1. MEMBERSHIP CHECK on /weights — non-participants get 404 so their
 *    5-second poll loop stays quiet and doesn't attempt to train.
 *
 * 2. alreadySubmitted FLAG — /weights returns whether this specific node
 *    already has an entry in pendingSubmissions for the current round.
 *    Queue.tsx uses this to sync lastSubmittedRoundRef after a page refresh/
 *    reconnect, preventing the dedup guard from permanently blocking re-entry.
 *
 * 3. NO-CACHE HEADERS on /weights and /masks — Express has ETag caching
 *    enabled by default. Without these headers, the browser serves a stale
 *    304 response where alreadySubmitted=false even after the client has
 *    submitted, causing the polling safety net to re-trigger training,
 *    which disposes the model mid-round and stalls the round permanently.
 */

const express  = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const fedOrch  = require('../services/federatedOrchestrator');

const router = express.Router();

// ─── GET /api/federated/weights ───────────────────────────────────────────────
router.get('/weights', authenticate, (req, res) => {
  // FIX 3: Disable ETag/304 caching — alreadySubmitted and currentRound
  // change between requests and must always return a fresh response.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');

  const activeJob     = fedOrch.getActiveJob();
  const globalWeights = fedOrch.getGlobalWeights();
  const companyId     = req.company.companyId;

  if (!activeJob) return res.status(404).json({ error: 'No active training job' });

  // FIX 1: Membership check — only job participants may poll for weights.
  if (!activeJob.participantIds.includes(companyId)) {
    return res.status(404).json({ error: 'No active training job for this node' });
  }

  // FIX 2: Has this node already submitted for the current round?
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
  // FIX 3: No caching on masks either — round number changes each round.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');

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

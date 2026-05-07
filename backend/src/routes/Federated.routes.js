/**
 * federated.routes.js
 * Place at: backend/src/routes/federated.routes.js
 *
 * Three endpoints that power real on-device federated learning with
 * pairwise masking + meta-aggregation:
 *
 *   GET  /api/federated/weights   — node fetches current global weights
 *                                   before starting local training
 *
 *   GET  /api/federated/masks     — node fetches its pairwise mask assignments
 *                                   (one seed per peer, generated fresh each round)
 *
 *   POST /api/federated/submit    — node submits MASKED weight update + metrics
 *                                   after local training
 *
 * Register in app.js:
 *   const federatedRoutes = require('./routes/federated.routes');
 *   app.use('/api/federated', federatedRoutes);
 *
 * Also update queueService.js:
 *   const simulatedOrch = require('./federatedOrchestrator');  ← change require path
 */

const express  = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const fedOrch  = require('../services/federatedOrchestrator');

const router = express.Router();

// ─── GET /api/federated/weights ───────────────────────────────────────────────
/**
 * Returns the current global model weights.
 *
 * Round 1  → { hasWeights: false }           nodes initialise their own models
 * Round 2+ → { hasWeights: true, weights }   nodes apply global weights first
 */
router.get('/weights', authenticate, (req, res) => {
  const activeJob     = fedOrch.getActiveJob();
  const globalWeights = fedOrch.getGlobalWeights();

  if (!activeJob) return res.status(404).json({ error: 'No active training job' });

  if (!globalWeights) {
    return res.status(200).json({
      hasWeights:   false,
      jobId:        activeJob.jobId,
      currentRound: activeJob.currentRound,
      totalRounds:  activeJob.totalRounds,
    });
  }

  return res.status(200).json({
    hasWeights:   true,
    jobId:        activeJob.jobId,
    currentRound: activeJob.currentRound,
    totalRounds:  activeJob.totalRounds,
    weights:      globalWeights,
  });
});

// ─── GET /api/federated/masks ─────────────────────────────────────────────────
/**
 * Returns this node's pairwise mask assignments for the current round.
 *
 * Response:
 * {
 *   jobId:       string,
 *   round:       number,
 *   assignments: [
 *     { peerId: string, seed: number, role: 'add' | 'sub' },
 *     ...
 *   ]
 * }
 *
 * The node uses these to call localTrainer.applyPairwiseMasks() before
 * submitting its weights. Seeds are generated fresh each round and are
 * never stored permanently — they are discarded once all submissions
 * arrive (the masks cancel on summation, so no server-side unmasking
 * step is ever needed).
 */
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
/**
 * Called by a node after it has finished local training AND applied its
 * pairwise masks. Accepts masked weight arrays + unmasked training metrics.
 *
 * Body:
 * {
 *   jobId:         string,
 *   round:         number,
 *   maskedWeights: { shapes: number[][], values: number[][] },
 *   metrics:       { accuracy, loss, datasetSize, durationMs, epochsRun }
 * }
 *
 * The server sums all incoming maskedWeights — pairwise masks cancel
 * automatically, yielding the true aggregate without ever seeing
 * any individual node's raw weights.
 */
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

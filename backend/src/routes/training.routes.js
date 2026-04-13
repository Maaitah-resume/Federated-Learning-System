// src/routes/training.routes.js
const express              = require('express');
const jobManager           = require('../services/jobManager');
const orchestratorService  = require('../services/orchestratorService');
const Participant          = require('../models/Participant');
const { authenticate }     = require('../middleware/authMiddleware');
const { PARTICIPANT_STATUS } = require('../config/constants');

const router = express.Router();

// GET /api/training/status?jobId=<jobId>
router.get('/status', authenticate, async (req, res, next) => {
  try {
    const job = req.query.jobId
      ? await jobManager.getJobById(req.query.jobId)
      : await jobManager.getActiveJob();

    if (!job) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'No active training job found' },
      });
    }

    const participants = await jobManager.getParticipants(job.jobId);
    const round        = await jobManager.getRound(job.jobId, job.currentRound);

    return res.status(200).json({
      jobId:        job.jobId,
      status:       job.status,
      currentRound: job.currentRound,
      totalRounds:  job.totalRounds,
      participants: participants.map((p) => ({
        companyId:       p.companyId,
        status:          p.status,
        roundsCompleted: p.roundsCompleted,
      })),
      metrics: {
        latestLoss:     round?.aggregationMetrics?.avgLoss      ?? null,
        latestAccuracy: round?.aggregationMetrics?.accuracyDelta ?? null,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/training/model?jobId=<jobId>&round=<round>
router.get('/model', authenticate, async (req, res, next) => {
  try {
    const { jobId, round } = req.query;
    if (!jobId || !round) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'jobId and round are required' },
      });
    }

    const job = await jobManager.getJobById(jobId);
    if (!job) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }

    if (!job.participantIds.includes(req.company.companyId)) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You are not a participant of this job' },
      });
    }

    const trainingRound = await jobManager.getRound(jobId, parseInt(round, 10));
    if (!trainingRound) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Round not started' } });
    }

    const pythonBridge = require('../services/pythonBridge');
    const result = await pythonBridge.distribute(jobId, parseInt(round, 10), job.participantIds);

    return res.status(200).json({
      weightsB64:   result.round_model_b64,
      modelVersion: job.globalModelVersion,
      round:        parseInt(round, 10),
    });
  } catch (err) { next(err); }
});

// POST /api/training/submit-weights
router.post('/submit-weights', authenticate, async (req, res, next) => {
  try {
    const { jobId, round, weightsB64, datasetSize } = req.body;
    const { companyId } = req.company;

    if (!jobId || !round || !weightsB64) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'jobId, round and weightsB64 are required' },
      });
    }

    const job = await jobManager.getJobById(jobId);
    if (!job) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }

    if (!job.participantIds.includes(companyId)) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You are not a participant of this job' },
      });
    }

    if (round !== job.currentRound) {
      return res.status(400).json({
        error: { code: 'WRONG_ROUND', message: `Expected round ${job.currentRound}, got ${round}` },
      });
    }

    const trainingRound = await jobManager.getRound(jobId, round);
    if (trainingRound?.participantsSubmitted?.includes(companyId)) {
      return res.status(409).json({
        error: { code: 'ALREADY_SUBMITTED', message: 'Already submitted weights for this round' },
      });
    }

    // Record in DB first, then forward to orchestrator
    await jobManager.recordWeightSubmission(jobId, round, companyId);
    await Participant.findOneAndUpdate(
      { companyId, jobId },
      { $set: { status: PARTICIPANT_STATUS.SUBMITTED } }
    );

    const waitingFor = await orchestratorService.receiveWeights(
      jobId, companyId, weightsB64, datasetSize || 0, round
    );

    return res.status(200).json({ submitted: true, waitingFor: waitingFor ?? 0 });
  } catch (err) { next(err); }
});

// GET /api/training/history
router.get('/history', authenticate, async (req, res, next) => {
  try {
    const history = await jobManager.getJobHistory();
    return res.status(200).json(history);
  } catch (err) { next(err); }
});

module.exports = router;
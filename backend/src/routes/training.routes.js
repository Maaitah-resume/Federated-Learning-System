// src/routes/training.routes.js
const express         = require('express');
const Participant     = require('../models/Participant');
const WeightSnapshot  = require('../models/WeightSnapshot');
const jobManager      = require('../services/jobManager');
const pythonBridge    = require('../services/pythonBridge');
const emitter         = require('../websocket/eventEmitter');
const { authenticate }= require('../middleware/authMiddleware');
const { JOB_STATUS, PARTICIPANT_STATUS, ROUND_STATUS, WS_EVENTS } = require('../config/constants');

const router = express.Router();

// GET /training/status?jobId=<jobId>
router.get('/status', authenticate, async (req, res, next) => {
  try {
    const { jobId } = req.query;

    const job = jobId
      ? await jobManager.getJobById(jobId)
      : await jobManager.getActiveJob();

    if (!job) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'No active training job found' },
      });
    }

    const participants = await Participant.find({ jobId: job.jobId });
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
        latestLoss:     round?.aggregationMetrics?.avgLoss     ?? null,
        latestAccuracy: round?.aggregationMetrics?.accuracyDelta ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /training/model?jobId=<jobId>&round=<round>
// Returns the global model weights for the current round so a company can train locally
router.get('/model', authenticate, async (req, res, next) => {
  try {
    const { jobId, round } = req.query;
    const { companyId }    = req.company;

    if (!jobId || !round) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'jobId and round are required query params' },
      });
    }

    const job = await jobManager.getJobById(jobId);
    if (!job) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }

    // Verify this company is a participant
    if (!job.participantIds.includes(companyId)) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You are not a participant of this job' },
      });
    }

    const roundNum = parseInt(round, 10);
    const trainingRound = await jobManager.getRound(jobId, roundNum);
    if (!trainingRound) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Round not started yet' },
      });
    }

    // Fetch current round weights from Python service
    const result = await pythonBridge.distribute(jobId, roundNum, job.participantIds);

    return res.status(200).json({
      weightsB64:   result.round_model_b64,
      modelVersion: job.globalModelVersion,
      round:        roundNum,
    });
  } catch (err) {
    next(err);
  }
});

// POST /training/submit-weights
router.post('/submit-weights', authenticate, async (req, res, next) => {
  try {
    const { jobId, round, weightsB64, datasetSize } = req.body;
    const { companyId } = req.company;

    if (!jobId || !round || !weightsB64) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'jobId, round, and weightsB64 are required' },
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

    // Check for duplicate submission
    const trainingRound = await jobManager.getRound(jobId, round);
    if (trainingRound?.participantsSubmitted?.includes(companyId)) {
      return res.status(409).json({
        error: { code: 'ALREADY_SUBMITTED', message: 'You have already submitted weights for this round' },
      });
    }

    // Forward weights to Python FL service buffer
    const pyResult = await pythonBridge.receiveWeights(jobId, round, companyId, weightsB64, datasetSize || 0);

    // Record submission in MongoDB
    const updatedRound = await jobManager.recordWeightSubmission(jobId, round, companyId);

    await WeightSnapshot.create({
      jobId,
      roundNumber:  round,
      companyId,
      storagePath:  `weights/${jobId}/round_${round}/${companyId}.bin`,
      datasetSize:  datasetSize || 0,
      submittedAt:  new Date(),
    });

    await Participant.findOneAndUpdate(
      { companyId, jobId },
      { $set: { status: PARTICIPANT_STATUS.SUBMITTED } }
    );

    const submittedCount  = updatedRound.participantsSubmitted.length;
    const expectedCount   = updatedRound.participantsExpected.length;

    // Notify all clients a submission arrived
    emitter.emit(WS_EVENTS.WEIGHTS_RECEIVED, {
      jobId, round, received: submittedCount, total: expectedCount,
    });

    // All weights collected — trigger aggregation
    if (submittedCount >= expectedCount) {
      emitter.emit('internal:aggregate', { jobId, round });
    }

    return res.status(200).json({
      submitted:  true,
      waitingFor: pyResult.waiting_for ?? (expectedCount - submittedCount),
    });
  } catch (err) {
    next(err);
  }
});

// GET /training/history
router.get('/history', authenticate, async (req, res, next) => {
  try {
    const history = await jobManager.getJobHistory();
    return res.status(200).json(history);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
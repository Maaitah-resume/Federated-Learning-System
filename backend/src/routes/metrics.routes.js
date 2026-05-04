const express = require('express');
const TrainingMetric = require('../models/TrainingMetric');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/metrics/current — metrics for the active job (or latest)
router.get('/current', authenticate, async (req, res, next) => {
  try {
    // Find the most recent jobId
    const latest = await TrainingMetric.findOne().sort({ createdAt: -1 });
    if (!latest) return res.status(200).json({ jobId: null, rounds: [], localMetrics: [] });

    const jobId = latest.jobId;

    // Global metrics per round (for charts)
    const rounds = await TrainingMetric.find({ jobId, type: 'global' })
      .sort({ round: 1 })
      .select('round accuracy loss f1Score precision recall createdAt');

    // Latest local metrics from each participant (current round)
    const maxRound = Math.max(...rounds.map(r => r.round), 0);
    const localMetrics = await TrainingMetric.find({
      jobId,
      type: 'local',
      round: maxRound,
    }).select('companyId accuracy loss datasetSize durationMs');

    return res.status(200).json({ jobId, rounds, localMetrics });
  } catch (err) { next(err); }
});

// GET /api/metrics/:jobId — full history for a specific job
router.get('/:jobId', authenticate, async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const rounds = await TrainingMetric.find({ jobId, type: 'global' })
      .sort({ round: 1 });
    const localMetrics = await TrainingMetric.find({ jobId, type: 'local' })
      .sort({ round: 1 });
    return res.status(200).json({ jobId, rounds, localMetrics });
  } catch (err) { next(err); }
});

// GET /api/metrics — list all completed jobs with their final metrics
router.get('/', authenticate, async (req, res, next) => {
  try {
    const jobs = await TrainingMetric.aggregate([
      { $match: { type: 'global' } },
      { $sort: { round: -1 } },
      { $group: {
          _id: '$jobId',
          finalRound:    { $first: '$round' },
          finalAccuracy: { $first: '$accuracy' },
          finalLoss:     { $first: '$loss' },
          completedAt:   { $first: '$createdAt' },
      }},
      { $sort: { completedAt: -1 } },
      { $limit: 10 },
    ]);
    return res.status(200).json({ jobs });
  } catch (err) { next(err); }
});

module.exports = router;

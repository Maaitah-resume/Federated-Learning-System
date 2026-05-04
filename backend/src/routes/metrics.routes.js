const express = require('express');
const TrainingMetric = require('../models/TrainingMetric');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/metrics/current
router.get('/current', authenticate, async (req, res, next) => {
  try {
    const myCompanyId = req.company.companyId;

    // Find the most recent job this user participated in
    const myLatest = await TrainingMetric.findOne({
      companyId: myCompanyId,
      type: 'local',
    }).sort({ createdAt: -1 });

    if (!myLatest) {
      return res.status(200).json({ jobId: null, rounds: [], myMetrics: [] });
    }

    const jobId = myLatest.jobId;

    // Global metrics per round (shared — safe to show)
    const rounds = await TrainingMetric.find({ jobId, type: 'global' })
      .sort({ round: 1 })
      .select('round accuracy loss f1Score precision recall createdAt');

    // Only THIS user's local metrics — never other participants
    const myMetrics = await TrainingMetric.find({
      jobId,
      type: 'local',
      companyId: myCompanyId,
    })
      .sort({ round: 1 })
      .select('round accuracy loss datasetSize durationMs epochsRun');

    const maxRound = rounds.length > 0 ? rounds[rounds.length - 1].round : 0;

    return res.status(200).json({ jobId, rounds, myMetrics, maxRound });
  } catch (err) { next(err); }
});

// GET /api/metrics/:jobId — full history for a job (own metrics only)
router.get('/:jobId', authenticate, async (req, res, next) => {
  try {
    const myCompanyId = req.company.companyId;
    const { jobId } = req.params;

    const rounds = await TrainingMetric.find({ jobId, type: 'global' })
      .sort({ round: 1 });

    const myMetrics = await TrainingMetric.find({
      jobId,
      type: 'local',
      companyId: myCompanyId,
    }).sort({ round: 1 });

    return res.status(200).json({ jobId, rounds, myMetrics });
  } catch (err) { next(err); }
});

module.exports = router;

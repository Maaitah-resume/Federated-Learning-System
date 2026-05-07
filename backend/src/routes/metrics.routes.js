// backend/src/routes/metrics.routes.js
const express        = require('express');
const TrainingMetric = require('../models/TrainingMetric');
const Participant    = require('../models/Participant');
const fedOrch        = require('../services/federatedOrchestrator');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/metrics/current
// When a job is running → return live metrics for that job
// When no job is running → fall back to the MOST RECENT completed job
// (so the dashboard always shows data, not a blank chart)
router.get('/current', authenticate, async (req, res, next) => {
  try {
    const myCompanyId = req.company.companyId;
    const activeJob   = fedOrch.getActiveJob();

    let jobId;

    if (activeJob) {
      // Live job running — show its metrics (updates each round)
      jobId = activeJob.jobId;
    } else {
      // No active job — find most recent job this user participated in
      const latest = await TrainingMetric.findOne({ companyId: myCompanyId, type: 'local' })
        .sort({ createdAt: -1 });

      if (!latest) {
        // No history at all
        return res.status(200).json({ jobId: null, rounds: [], myMetrics: [], maxRound: 0 });
      }
      jobId = latest.jobId;
    }

    const rounds = await TrainingMetric.find({ jobId, type: 'global' })
      .sort({ round: 1 })
      .select('round accuracy loss f1Score precision recall createdAt');

    const myMetrics = await TrainingMetric.find({ jobId, type: 'local', companyId: myCompanyId })
      .sort({ round: 1 })
      .select('round accuracy loss datasetSize durationMs epochsRun');

    const maxRound = rounds.length > 0 ? rounds[rounds.length - 1].round : 0;

    return res.status(200).json({ jobId, rounds, myMetrics, maxRound });
  } catch (err) { next(err); }
});

// GET /api/metrics/admin/current — all participant metrics for active job
router.get('/admin/current', authenticate, async (req, res, next) => {
  try {
    const activeJob = fedOrch.getActiveJob();
    if (!activeJob) {
      return res.status(200).json({ jobId: null, rounds: [], participants: [] });
    }
    const jobId = activeJob.jobId;
    const rounds = await TrainingMetric.find({ jobId, type: 'global' }).sort({ round: 1 });
    const allMetrics = await TrainingMetric.find({ jobId, type: 'local' })
      .sort({ round: 1 }).select('companyId round accuracy loss datasetSize durationMs');
    const maxRound = rounds.length > 0 ? rounds[rounds.length - 1].round : 0;
    const activeParticipants = await Participant.countDocuments({ jobId });
    return res.status(200).json({
      jobId, rounds,
      participants: allMetrics.map(m => ({ ...m.toObject(), companyName: m.companyId })),
      maxRound, activeParticipants,
    });
  } catch (err) { next(err); }
});

// GET /api/metrics/:jobId — full history for a specific job
router.get('/:jobId', authenticate, async (req, res, next) => {
  try {
    const { jobId }   = req.params;
    const myCompanyId = req.company.companyId;
    const rounds    = await TrainingMetric.find({ jobId, type: 'global' }).sort({ round: 1 });
    const myMetrics = await TrainingMetric.find({ jobId, type: 'local', companyId: myCompanyId }).sort({ round: 1 });
    return res.status(200).json({ jobId, rounds, myMetrics });
  } catch (err) { next(err); }
});

module.exports = router;

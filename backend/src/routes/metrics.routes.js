// backend/src/routes/metrics.routes.js
const express        = require('express');
const TrainingMetric = require('../models/TrainingMetric');
const Participant    = require('../models/Participant');
const fedOrch        = require('../services/federatedOrchestrator');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/metrics/current
// Returns metrics for the currently active job only.
// If no job is active, returns empty arrays so the dashboard resets.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/current', authenticate, async (req, res, next) => {
  try {
    const myCompanyId = req.company.companyId;
    const activeJob   = fedOrch.getActiveJob();

    // No active job → clear the dashboard (don't show stale past data)
    if (!activeJob) {
      return res.status(200).json({ jobId: null, rounds: [], myMetrics: [], maxRound: 0 });
    }

    const jobId = activeJob.jobId;

    // Global metrics per round (safe to share with all participants)
    const rounds = await TrainingMetric.find({ jobId, type: 'global' })
      .sort({ round: 1 })
      .select('round accuracy loss f1Score precision recall createdAt');

    // Only THIS user's local metrics — never other participants' data
    const myMetrics = await TrainingMetric.find({
      jobId,
      type:      'local',
      companyId: myCompanyId,
    })
      .sort({ round: 1 })
      .select('round accuracy loss datasetSize durationMs epochsRun');

    const maxRound = rounds.length > 0 ? rounds[rounds.length - 1].round : 0;

    return res.status(200).json({ jobId, rounds, myMetrics, maxRound });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/metrics/admin/current
// Admin-only view: all participant metrics for the active job.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/current', authenticate, async (req, res, next) => {
  try {
    const activeJob = fedOrch.getActiveJob();

    if (!activeJob) {
      return res.status(200).json({ jobId: null, rounds: [], participants: [] });
    }

    const jobId = activeJob.jobId;

    const rounds = await TrainingMetric.find({ jobId, type: 'global' })
      .sort({ round: 1 });

    const allParticipantMetrics = await TrainingMetric.find({ jobId, type: 'local' })
      .sort({ round: 1 })
      .select('companyId round accuracy loss datasetSize durationMs');

    const enrichedMetrics = allParticipantMetrics.map(m => ({
      ...m.toObject(),
      companyName: m.companyId,
    }));

    const maxRound         = rounds.length > 0 ? rounds[rounds.length - 1].round : 0;
    const activeParticipants = await Participant.countDocuments({ jobId });

    return res.status(200).json({
      jobId,
      rounds,
      participants: enrichedMetrics,
      maxRound,
      activeParticipants,
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/metrics/:jobId
// Full history for a specific past job (own metrics only).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:jobId', authenticate, async (req, res, next) => {
  try {
    const myCompanyId = req.company.companyId;
    const { jobId }   = req.params;

    const rounds = await TrainingMetric.find({ jobId, type: 'global' })
      .sort({ round: 1 });

    const myMetrics = await TrainingMetric.find({
      jobId,
      type:      'local',
      companyId: myCompanyId,
    }).sort({ round: 1 });

    return res.status(200).json({ jobId, rounds, myMetrics });
  } catch (err) { next(err); }
});

module.exports = router;

const express = require('express');
const TrainingMetric = require('../models/TrainingMetric');
const Participant = require('../models/Participant');
const fedOrch = require('../services/federatedOrchestrator');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/metrics/current
router.get('/current', authenticate, async (req, res, next) => {
  try {
    const activeJob = fedOrch.getActiveJob();

    // If no job is active, send null so the dashboard clears past charts
    if (!activeJob) {
      return res.status(200).json({ jobId: null, rounds: [], myMetrics: [], maxRound: 0 });
    }

    const jobId = activeJob.jobId;
    // Now fetch ONLY metrics where jobId === activeJob.jobId
    const rounds = await TrainingMetric.find({ jobId, type: 'global' }).sort({ round: 1 });
    const myMetrics = await TrainingMetric.find({
      jobId,
      type: 'local',
      companyId: req.company.companyId,
    }).sort({ round: 1 });

    return res.status(200).json({ jobId, rounds, myMetrics, maxRound: rounds.length });
  } catch (err) { next(err); }
});
    

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

// ============================================
// NEW: GET /api/metrics/admin/current
// ============================================
router.get('/admin/current', authenticate, async (req, res, next) => {
  try {
    const activeJob = await jobManager.getActiveJob();
    
    if (!activeJob) {
      return res.status(200).json({ jobId: null, rounds: [], participants: [] });
    }

    const jobId = activeJob.jobId;

    const rounds = await TrainingMetric.find({ jobId, type: 'global' }).sort({ round: 1 });
    const allParticipantMetrics = await TrainingMetric.find({ jobId, type: 'local' })
      .sort({ round: 1 })
      .select('companyId round accuracy loss datasetSize durationMs');

    const participantIds = [...new Set(allParticipantMetrics.map(m => m.companyId))];
    const enrichedMetrics = allParticipantMetrics.map(metric => ({
      ...metric.toObject(),
      companyName: metric.companyId,
    }));

    const maxRound = rounds.length > 0 ? rounds[rounds.length - 1].round : 0;
    const activeParticipants = await Participant.find({ jobId }).countDocuments();

    return res.status(200).json({ 
      jobId, 
      rounds, 
      participants: enrichedMetrics,
      maxRound,
      activeParticipants,
    });
  } catch (err) { next(err); }
});

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

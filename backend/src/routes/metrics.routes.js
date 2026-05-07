const express = require('express');
const TrainingMetric = require('../models/TrainingMetric');
const Participant = require('../models/Participant');
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
      return res.status(200).json({ 
        jobId: null, 
        rounds: [], 
        myMetrics: [],
        maxRound: 0 
      });
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

// ============================================
// NEW: GET /api/metrics/admin/current
// ============================================
router.get('/admin/current', authenticate, async (req, res, next) => {
  try {
    // Verify user is admin
    if (req.company.role !== 'admin') {
      return res.status(403).json({ 
        error: { code: 'FORBIDDEN', message: 'Admin access required' } 
      });
    }

    // Get the most recent active job from any training metrics
    const latestMetric = await TrainingMetric.findOne()
      .sort({ createdAt: -1 });

    if (!latestMetric) {
      return res.status(200).json({ 
        jobId: null, 
        rounds: [], 
        participants: [],
        maxRound: 0,
        activeParticipants: []
      });
    }

    const jobId = latestMetric.jobId;

    // Get global metrics per round
    const rounds = await TrainingMetric.find({ jobId, type: 'global' })
      .sort({ round: 1 })
      .select('round accuracy loss f1Score precision recall createdAt');

    // Get ALL participants' local metrics for this job
    const allParticipantMetrics = await TrainingMetric.find({
      jobId,
      type: 'local',
    })
      .sort({ round: 1 })
      .select('companyId round accuracy loss datasetSize durationMs');

    // Get participant details (company names)
    const participantIds = [
      ...new Set(allParticipantMetrics.map(m => m.companyId))
    ];
    
    const participants = await Participant.find({ companyId: { $in: participantIds } })
      .select('companyId');

    // Enrich metrics with participant info
    const enrichedMetrics = allParticipantMetrics.map(metric => ({
      ...metric.toObject(),
      companyName: metric.companyId,
    }));

    const maxRound = rounds.length > 0 ? rounds[rounds.length - 1].round : 0;

    // Get active participant count for this job
    const activeParticipants = await Participant.find({ jobId })
      .countDocuments();

    return res.status(200).json({ 
      jobId, 
      rounds, 
      participants: enrichedMetrics,
      maxRound,
      activeParticipants,
    });
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

// src/routes/queue.routes.js
const express       = require('express');
const Participant   = require('../models/Participant');
const Company       = require('../models/Company');
const jobManager    = require('../services/jobManager');
const emitter       = require('../websocket/eventEmitter');
const { authenticate } = require('../middleware/authMiddleware');
const { PARTICIPANT_STATUS, WS_EVENTS } = require('../config/constants');
const { MIN_CLIENTS } = require('../config/env');

const router = express.Router();

// GET /queue
router.get('/', authenticate, async (req, res, next) => {
  try {
    const queued = await Participant.find({ status: PARTICIPANT_STATUS.QUEUED, jobId: null });

    const companyIds = queued.map((p) => p.companyId);
    const companies  = await Company.find({ companyId: { $in: companyIds } }).select('companyId companyName');
    const nameMap    = Object.fromEntries(companies.map((c) => [c.companyId, c.companyName]));

    const participants = queued.map((p) => ({
      companyId:   p.companyId,
      companyName: nameMap[p.companyId] || p.companyId,
      joinedAt:    p.joinedQueueAt,
    }));

    const activeJob = await jobManager.getActiveJob();

    return res.status(200).json({
      participants,
      count:        participants.length,
      minRequired:  MIN_CLIENTS,
      readyToStart: participants.length >= MIN_CLIENTS,
      activeJob:    activeJob ? { jobId: activeJob.jobId, status: activeJob.status } : null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /queue/join
router.post('/join', authenticate, async (req, res, next) => {
  try {
    const { companyId } = req.company;

    // Block if already in queue
    const existing = await Participant.findOne({ companyId, status: PARTICIPANT_STATUS.QUEUED, jobId: null });
    if (existing) {
      return res.status(409).json({
        error: { code: 'ALREADY_QUEUED', message: 'You are already in the training queue' },
      });
    }

    // Block if already in an active job
    const activeJob = await jobManager.getActiveJob();
    if (activeJob && activeJob.participantIds.includes(companyId)) {
      return res.status(409).json({
        error: { code: 'ALREADY_IN_JOB', message: 'Training is already in progress for your company' },
      });
    }

    await Participant.findOneAndUpdate(
      { companyId, jobId: null },
      { $set: { status: PARTICIPANT_STATUS.QUEUED, joinedQueueAt: new Date() } },
      { upsert: true, new: true }
    );

    // Broadcast updated queue state to all clients
    emitter.emit(WS_EVENTS.QUEUE_UPDATED);

    const queuedCount = await Participant.countDocuments({ status: PARTICIPANT_STATUS.QUEUED, jobId: null });

    return res.status(200).json({
      joined:     true,
      position:   queuedCount,
      queueState: { count: queuedCount, minRequired: MIN_CLIENTS },
    });
  } catch (err) {
    next(err);
  }
});

// POST /queue/leave
router.post('/leave', authenticate, async (req, res, next) => {
  try {
    const { companyId } = req.company;

    const participant = await Participant.findOne({ companyId, status: PARTICIPANT_STATUS.QUEUED, jobId: null });

    if (!participant) {
      return res.status(400).json({
        error: { code: 'NOT_IN_QUEUE', message: 'You are not currently in the queue' },
      });
    }

    // Cannot leave if active training round is in progress
    const activeJob = await jobManager.getActiveJob();
    if (activeJob && activeJob.participantIds.includes(companyId)) {
      return res.status(400).json({
        error: { code: 'CANNOT_LEAVE', message: 'Cannot leave during an active training round' },
      });
    }

    await Participant.deleteOne({ _id: participant._id });

    emitter.emit(WS_EVENTS.QUEUE_UPDATED);

    return res.status(200).json({ left: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
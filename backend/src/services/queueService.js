// src/services/queueService.js
const Participant   = require('../models/Participant');
const Company       = require('../models/Company');
const UserData      = require('../models/UserData');
const jobManager    = require('./jobManager');
const emitter       = require('../websocket/eventEmitter');
const { PARTICIPANT_STATUS, WS_EVENTS } = require('../config/constants');
const { MIN_CLIENTS, DEFAULT_ROUNDS }   = require('../config/env');

// In-memory lock flag to prevent double-start race condition
let isStartingJob = false;

// ─── Queue Reads ────────────────────────────────────────────────────────────

/**
 * Returns the current queue state — list of waiting companies + metadata.
 */
async function getQueueState() {
  const queued = await Participant.find({
    status: PARTICIPANT_STATUS.QUEUED,
    jobId:  null,
  });

  const companyIds = queued.map((p) => p.companyId);
  const companies  = await Company.find({ companyId: { $in: companyIds } })
    .select('companyId companyName');

  const nameMap = Object.fromEntries(companies.map((c) => [c.companyId, c.companyName]));

  return {
    participants: queued.map((p) => ({
      companyId:   p.companyId,
      companyName: nameMap[p.companyId] || p.companyId,
      joinedAt:    p.joinedQueueAt,
      status:      p.status,
    })),
    count:        queued.length,
    minRequired:  MIN_CLIENTS,
    readyToStart: queued.length >= MIN_CLIENTS,
  };
}

// ─── Join ────────────────────────────────────────────────────────────────────

/**
 * Adds a company to the queue.
 * Returns the updated queue state.
 * Throws if no data uploaded, already queued, or already in an active job.
 */
async function joinQueue(companyId) {
  // Require uploaded data before joining
  const userData = await UserData.findOne({ companyId });
  if (!userData) {
    throw Object.assign(new Error('Please upload your data before joining the queue'), {
      status: 400,
      code:   'NO_DATA_UPLOADED',
    });
  }

  // Already in queue?
  const existing = await Participant.findOne({
    companyId,
    status: PARTICIPANT_STATUS.QUEUED,
    jobId:  null,
  });
  if (existing) {
    throw Object.assign(new Error('Already in queue'), {
      status: 409,
      code:   'ALREADY_QUEUED',
    });
  }

  // Already in an active training job?
  const activeJob = await jobManager.getActiveJob();
  if (activeJob && activeJob.participantIds.includes(companyId)) {
    throw Object.assign(new Error('Training already in progress for your company'), {
      status: 409,
      code:   'ALREADY_IN_JOB',
    });
  }

  // Create or update the participant record
  await Participant.findOneAndUpdate(
    { companyId, jobId: null },
    {
      $set: {
        status:        PARTICIPANT_STATUS.QUEUED,
        joinedQueueAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  console.log(`[Queue] ${companyId} joined the queue`);

  // Broadcast updated queue to all connected browsers
  const state = await getQueueState();
  emitter.emit(WS_EVENTS.QUEUE_UPDATED, state);

  // Check if we have enough participants to start
  await checkAndStart();

  return state;
}

// ─── Leave ───────────────────────────────────────────────────────────────────

/**
 * Removes a company from the queue.
 * Throws if they are not in the queue.
 */
async function leaveQueue(companyId) {
  const participant = await Participant.findOne({
    companyId,
    status: PARTICIPANT_STATUS.QUEUED,
    jobId:  null,
  });

  if (!participant) {
    throw Object.assign(new Error('Not currently in the queue'), {
      status: 400,
      code:   'NOT_IN_QUEUE',
    });
  }

  await Participant.deleteOne({ _id: participant._id });

  console.log(`[Queue] ${companyId} left the queue`);

  const state = await getQueueState();
  emitter.emit(WS_EVENTS.QUEUE_UPDATED, state);

  return state;
}

// ─── Threshold check ─────────────────────────────────────────────────────────

/**
 * Called after every join.
 * If MIN_CLIENTS are waiting and no job is active, starts a new training job.
 */
async function checkAndStart() {
  if (isStartingJob) return;
  const count = await Participant.countDocuments({ ... });
  if (count < MIN_CLIENTS) return;  // ← waits for 3 (MIN_CLIENTS)
  // ...
  await orchestratorService.startJob(participantIds);
}

  if (count < MIN_CLIENTS) return;

  // Check no job is already running
  const activeJob = await jobManager.getActiveJob();
  if (activeJob) return;

  isStartingJob = true;
  console.log(`[Queue] Threshold reached (${count}/${MIN_CLIENTS}) — starting job`);

  try {
    // Snapshot exactly MIN_CLIENTS participants — the rest wait for the next job
    const participants = await Participant.find({
      status: PARTICIPANT_STATUS.QUEUED,
      jobId:  null,
    }).limit(MIN_CLIENTS);

    const participantIds = participants.map((p) => p.companyId);

    // Delegate job creation + orchestration to the orchestrator
    // (imported lazily to avoid circular dependency)
    const orchestratorService = require('./orchestratorService');
    await orchestratorService.startJob(participantIds);

  } catch (err) {
    console.error('[Queue] Failed to start job:', err.message);
  } finally {
    isStartingJob = false;
  }
}

/**
 * Polling fallback — runs every 10 seconds in case a WebSocket join event
 * was missed or the server restarted mid-queue.
 */
function startPolling() {
  setInterval(async () => {
    try {
      await checkAndStart();
    } catch (err) {
      console.error('[Queue] Polling error:', err.message);
    }
  }, 10_000);

  console.log('[Queue] Polling started (10s interval)');
}

module.exports = { getQueueState, joinQueue, leaveQueue, checkAndStart, startPolling };

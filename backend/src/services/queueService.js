const Participant        = require('../models/Participant');
const Company            = require('../models/Company');
const UserData           = require('../models/UserData');
const simulatedOrch      = require('./simulatedOrchestrator');
const emitter            = require('../websocket/eventEmitter');
const { PARTICIPANT_STATUS, WS_EVENTS } = require('../config/constants');
const { MIN_CLIENTS }    = require('../config/env');

let isStartingJob = false;

async function getQueueState() {
  const queued = await Participant.find({ status: PARTICIPANT_STATUS.QUEUED, jobId: null });

  const companyIds = queued.map((p) => p.companyId);
  const companies  = await Company.find({ companyId: { $in: companyIds } }).select('companyId companyName');
  const nameMap    = Object.fromEntries(companies.map((c) => [c.companyId, c.companyName]));

  const activeJob = simulatedOrch.getActiveJob();

  return {
    participants: queued.map((p) => ({
      companyId:   p.companyId,
      companyName: nameMap[p.companyId] || p.companyId,
      joinedAt:    p.joinedQueueAt,
      status:      p.status,
    })),
    count:        queued.length,
    minRequired:  MIN_CLIENTS || 3,
    readyToStart: queued.length >= (MIN_CLIENTS || 3),
    activeJob:    activeJob ? { jobId: activeJob.jobId, status: activeJob.status } : null,
  };
}

async function joinQueue(companyId) {
  // Require uploaded data
  const userData = await UserData.findOne({ companyId });
  if (!userData) {
    const err = new Error('Please upload your data before joining the queue');
    err.status = 400;
    throw err;
  }

  // Already queued?
  const existing = await Participant.findOne({ companyId, status: PARTICIPANT_STATUS.QUEUED, jobId: null });
  if (existing) {
    const err = new Error('Already in queue');
    err.status = 409;
    throw err;
  }

  // Already in active job?
  const activeJob = simulatedOrch.getActiveJob();
  if (activeJob && activeJob.participantIds.includes(companyId)) {
    const err = new Error('Training already in progress for your company');
    err.status = 409;
    throw err;
  }

  await Participant.findOneAndUpdate(
    { companyId, jobId: null },
    { $set: { status: PARTICIPANT_STATUS.QUEUED, joinedQueueAt: new Date() } },
    { upsert: true, new: true }
  );

  console.log(`[Queue] ${companyId} joined the queue`);

  const state = await getQueueState();
  emitter.emit(WS_EVENTS.QUEUE_UPDATED, state);

  await checkAndStart();
  return state;
}

async function leaveQueue(companyId) {
  const participant = await Participant.findOne({ companyId, status: PARTICIPANT_STATUS.QUEUED, jobId: null });
  if (!participant) {
    const err = new Error('Not currently in the queue');
    err.status = 400;
    throw err;
  }

  await Participant.deleteOne({ _id: participant._id });
  console.log(`[Queue] ${companyId} left the queue`);

  const state = await getQueueState();
  emitter.emit(WS_EVENTS.QUEUE_UPDATED, state);
  return state;
}

async function checkAndStart() {
  if (isStartingJob) return;

  const minClients = MIN_CLIENTS || 3;
  const count = await Participant.countDocuments({ status: PARTICIPANT_STATUS.QUEUED, jobId: null });

  if (count < minClients) {
    console.log(`[Queue] ${count}/${minClients} — not enough to start`);
    return;
  }

  const activeJob = simulatedOrch.getActiveJob();
  if (activeJob) {
    console.log('[Queue] Job already running');
    return;
  }

  isStartingJob = true;
  console.log(`[Queue] Threshold reached (${count}/${minClients}) — starting job`);

  try {
    const participants    = await Participant.find({ status: PARTICIPANT_STATUS.QUEUED, jobId: null }).limit(minClients);
    const participantIds  = participants.map((p) => p.companyId);
    await simulatedOrch.startJob(participantIds);
  } catch (err) {
    console.error('[Queue] Failed to start job:', err.message);
  } finally {
    isStartingJob = false;
  }
}

function startPolling() {
  setInterval(async () => {
    try { await checkAndStart(); } catch (err) { console.error('[Queue] Polling error:', err.message); }
  }, 10_000);
  console.log('[Queue] Polling started (10s interval)');
}

module.exports = { getQueueState, joinQueue, leaveQueue, checkAndStart, startPolling };

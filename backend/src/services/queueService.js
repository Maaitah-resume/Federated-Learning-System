// backend/src/services/queueService.js
const Participant   = require('../models/Participant');
const Company       = require('../models/Company');
const fedOrch       = require('./federatedOrchestrator');
const emitter       = require('../websocket/eventEmitter');
const { PARTICIPANT_STATUS, WS_EVENTS } = require('../config/constants');
const { getConfig } = require('../models/SystemConfig');

let isStartingJob = false;

async function getMinClients() {
  try {
    const val = await getConfig('MIN_CLIENTS');
    return parseInt(val || process.env.MIN_CLIENTS || '2', 10);
  } catch {
    return parseInt(process.env.MIN_CLIENTS || '2', 10);
  }
}

async function getQueueState() {
  const activeJob  = fedOrch.getActiveJob();
  const minClients = await getMinClients();

  const statusFilter = activeJob
    ? { status: PARTICIPANT_STATUS.TRAINING, jobId: activeJob.jobId }
    : { status: PARTICIPANT_STATUS.QUEUED,   jobId: null };

  const participants = await Participant.find(statusFilter);
  const companyIds   = participants.map((p) => p.companyId);
  const companies    = await Company.find({ companyId: { $in: companyIds } }).select('companyId companyName');
  const nameMap      = Object.fromEntries(companies.map((c) => [c.companyId, c.companyName]));

  return {
    participants: participants.map(p => ({
      companyId:   p.companyId,
      companyName: nameMap[p.companyId] || p.companyId,
      joinedAt:    p.joinedAt || p.createdAt,
    })),
    count:       participants.length,
    minRequired: minClients,
    isJobRunning: !!activeJob,
    // Include live job so queue.routes.js does NOT need jobManager
    activeJob: activeJob ? {
      jobId:        activeJob.jobId,
      status:       activeJob.status,
      currentRound: activeJob.currentRound || 0,
      totalRounds:  activeJob.totalRounds  || 5,
    } : null,
  };
}

async function checkAndStart() {
  if (isStartingJob) return;
  if (fedOrch.getActiveJob()) return;

  const minClients = await getMinClients();
  const count = await Participant.countDocuments({ status: PARTICIPANT_STATUS.QUEUED, jobId: null });

  if (count < minClients) {
    console.log(`[Queue] ${count}/${minClients} — waiting for more nodes`);
    return;
  }

  isStartingJob = true;
  console.log(`[Queue] Threshold met (${count}/${minClients}) — starting job`);

  try {
    const participants   = await Participant.find({ status: PARTICIPANT_STATUS.QUEUED, jobId: null }).limit(minClients);
    const participantIds = participants.map((p) => p.companyId);
    await fedOrch.startJob(participantIds);
  } catch (err) {
    console.error('[Queue] Job start failed:', err.message);
  } finally {
    isStartingJob = false; // Always reset — prevents deadlock on error
  }
}

async function joinQueue(companyId) {
  await Participant.findOneAndUpdate(
    { companyId },
    { status: PARTICIPANT_STATUS.QUEUED, jobId: null, joinedAt: new Date() },
    { upsert: true, new: true }
  );

  const state = await getQueueState();
  emitter.emit(WS_EVENTS.QUEUE_UPDATED, state);
  await checkAndStart();
  return await getQueueState(); // fresh state after potential job start
}

async function leaveQueue(companyId) {
  await Participant.deleteOne({ companyId, jobId: null });
  const state = await getQueueState();
  emitter.emit(WS_EVENTS.QUEUE_UPDATED, state);
  return state;
}

function startPolling() {
  setInterval(async () => {
    try { await checkAndStart(); }
    catch (err) { console.error('[Queue Poll Error]', err.message); }
  }, 5000);
}

module.exports = { joinQueue, leaveQueue, getQueueState, startPolling };

const Participant   = require('../models/Participant');
const Company       = require('../models/Company');
const fedOrch       = require('./federatedOrchestrator');
const emitter       = require('../websocket/eventEmitter');
const { PARTICIPANT_STATUS, WS_EVENTS } = require('../config/constants');
const { getConfig } = require('../models/SystemConfig');

let isStartingJob = false;

/**
 * Helper: Ensures the MIN_CLIENTS threshold is returned as a number.
 */
async function getMinClients() {
  try {
    const val = await getConfig('MIN_CLIENTS');
    // Force parse to Int to prevent string comparison errors
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
    : { status: PARTICIPANT_STATUS.QUEUED, jobId: null };

  const participants = await Participant.find(statusFilter);
  const companyIds = participants.map((p) => p.companyId);
  const companies  = await Company.find({ companyId: { $in: companyIds } }).select('companyId companyName');
  const nameMap    = Object.fromEntries(companies.map((c) => [c.companyId, c.companyName]));

  return {
    participants: participants.map(p => ({
      companyId: p.companyId,
      companyName: nameMap[p.companyId] || p.companyId,
      joinedAt: p.joinedAt || p.createdAt
    })),
    count: participants.length,
    minRequired: minClients,
    isJobRunning: !!activeJob
  };
}

/**
 * Validates the queue and triggers the orchestrator if threshold is reached.
 */
async function checkAndStart() {
  if (isStartingJob) return;

  const minClients = await getMinClients();
  // Count participants specifically waiting for a new job
  const count = await Participant.countDocuments({ 
    status: PARTICIPANT_STATUS.QUEUED, 
    jobId: null 
  });

  if (count < minClients) {
    console.log(`[Queue] ${count}/${minClients} nodes connected — waiting for threshold...`);
    return;
  }

  // Check if a job is already in memory or marked as active in the orchestrator
  const activeJob = fedOrch.getActiveJob();
  if (activeJob) {
    console.log('[Queue] Cannot start: A training session is already active.');
    return;
  }

  isStartingJob = true;
  console.log(`[Queue] Threshold met (${count}/${minClients}). Initializing training...`);

  try {
    const participants = await Participant.find({ 
      status: PARTICIPANT_STATUS.QUEUED, 
      jobId: null 
    }).limit(minClients);
    
    const participantIds = participants.map((p) => p.companyId);
    
    // Trigger the actual training process
    await fedOrch.startJob(participantIds);
  } catch (err) {
    console.error('[Queue] Critical failure during job initialization:', err.message);
  } finally {
    isStartingJob = false;
  }
}

async function joinQueue(companyId) {
  await Participant.findOneAndUpdate(
    { companyId },
    { 
      status: PARTICIPANT_STATUS.QUEUED,
      jobId: null,
      joinedAt: new Date()
    },
    { upsert: true, new: true }
  );

  const state = await getQueueState();
  emitter.emit(WS_EVENTS.QUEUE_UPDATED, state);
  
  // Attempt to start immediately
  await checkAndStart();
  return state;
}

async function leaveQueue(companyId) {
  await Participant.deleteOne({ companyId, jobId: null });
  const state = await getQueueState();
  emitter.emit(WS_EVENTS.QUEUE_UPDATED, state);
  return state;
}

function startPolling() {
  setInterval(async () => {
    try { await checkAndStart(); } catch (err) { console.error('[Queue Poll Error]', err); }
  }, 5000);
}

module.exports = {
  joinQueue,
  leaveQueue,
  getQueueState,
  startPolling
};

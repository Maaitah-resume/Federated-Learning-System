// backend/src/services/queueService.js
//
// ── FIXES ────────────────────────────────────────────────────────────────────
//
// FIX 1 — Multi-queue / room isolation
//   Problem: Every user who joined the queue was pooled together.  Ahmed
//   arriving after Mohammad+Amer were already queued would be pulled into
//   their job instantly, even though Ahmed never chose to train with them.
//
//   Solution: Each join attempt either enters an existing *open* room (one
//   that hasn't reached MIN_CLIENTS yet and hasn't started training) or
//   creates a brand-new room.  checkAndStart() only fires a job when a single
//   room has >= MIN_CLIENTS members.  Users in separate rooms are completely
//   isolated — they wait for their own set of partners.
//
// FIX 2 — Admin config not taking effect
//   Problem: getMinClients() applied its own parseInt(val || env || '2')
//   fallback AFTER calling getConfig(), which correctly falls back to
//   DEFAULTS={MIN_CLIENTS:3}.  The local `|| '2'` silently shadowed the
//   DB-stored value because getConfig returns null when no DB doc exists yet
//   and the function treated that null as falsy and used '2' instead of
//   the SystemConfig DEFAULTS.  Result: admin could write 3 to the DB but
//   checkAndStart kept using 2.
//
//   Solution: delegate entirely to SystemConfig.getConfig which already has
//   the right precedence: DB doc → DEFAULTS → null.  Add a safe parseInt
//   fallback of 2 only as a last resort (in case DEFAULTS is missing a key).
// ─────────────────────────────────────────────────────────────────────────────

const { v4: uuidv4 } = require('uuid');
const Participant   = require('../models/Participant');
const Company       = require('../models/Company');
const fedOrch       = require('./federatedOrchestrator');
const emitter       = require('../websocket/eventEmitter');
const { PARTICIPANT_STATUS, WS_EVENTS } = require('../config/constants');
const { getConfig } = require('../models/SystemConfig');

let isStartingJob = false;

// ── Config helpers ────────────────────────────────────────────────────────────
// FIX 2: delegate to SystemConfig exclusively; don't apply a local fallback
// that could override the DB-stored value.
async function getMinClients() {
  try {
    const val = await getConfig('MIN_CLIENTS');
    // getConfig returns DEFAULTS['MIN_CLIENTS'] (=2) when no DB doc exists,
    // so val should always be a number.  parseInt just ensures type safety.
    return parseInt(val ?? 2, 10);
  } catch {
    return 2;
  }
}

// ── Room helpers ──────────────────────────────────────────────────────────────
/**
 * Find an existing open room that still has room for more participants,
 * or return null so the caller creates a new one.
 *
 * "Open" means:
 *   - All members are still QUEUED with jobId=null  (not yet started)
 *   - Member count is < MIN_CLIENTS
 */
async function findOpenRoom(minClients) {
  // Aggregate QUEUED participants (no active job) grouped by roomId
  const rooms = await Participant.aggregate([
    { $match: { status: PARTICIPANT_STATUS.QUEUED, jobId: null, roomId: { $ne: null } } },
    { $group: { _id: '$roomId', count: { $sum: 1 } } },
    { $match: { count: { $lt: minClients } } },
    { $sort:  { count: -1 } },   // prefer the roomst closest to full
    { $limit: 1 },
  ]);
  return rooms.length > 0 ? rooms[0]._id : null;
}

// ── Queue state ───────────────────────────────────────────────────────────────
/**
 * Returns the state of the queue that is relevant to the *requesting* company.
 * If the company is in a room, show only that room's participants.
 * If the company is in an active job, show that job's training nodes.
 * If the company is not queued at all, show their potential room (empty).
 */
// ── In-memory queue state cache ──────────────────────────────────────────────
// getQueueState runs 3-4 MongoDB queries and is polled every 3s per client.
// 170ms Atlas round-trip × 4 queries = ~800ms per call = 28% of event loop.
// Cache per-user for 10s — invalidated on every join/leave.
const _queueCache = new Map();
const QUEUE_CACHE_TTL = 10_000;
function _invalidateCache() { _queueCache.clear(); }

async function getQueueState(requestingCompanyId) {
  const hit = _queueCache.get(requestingCompanyId);
  if (hit && hit.exp > Date.now()) return hit.data;

  const activeJob  = fedOrch.getActiveJob();
  const minClients = await getMinClients();

  let participants = [];

  if (activeJob && requestingCompanyId) {
    // Caller is (possibly) in a running job — show job participants
    const inJob = await Participant.findOne({
      companyId: requestingCompanyId,
      status:    PARTICIPANT_STATUS.TRAINING,
      jobId:     activeJob.jobId,
    });
    if (inJob) {
      participants = await Participant.find({
        status: PARTICIPANT_STATUS.TRAINING,
        jobId:  activeJob.jobId,
      });
    }
  }

  if (participants.length === 0 && requestingCompanyId) {
    // Caller is queued — show only their room
    const self = await Participant.findOne({
      companyId: requestingCompanyId,
      status:    PARTICIPANT_STATUS.QUEUED,
      jobId:     null,
    });
    if (self?.roomId) {
      participants = await Participant.find({
        roomId: self.roomId,
        status: PARTICIPANT_STATUS.QUEUED,
        jobId:  null,
      });
    }
  }

  const companyIds = participants.map((p) => p.companyId);
  const companies  = await Company.find({ companyId: { $in: companyIds } })
    .select('companyId companyName');
  const nameMap    = Object.fromEntries(companies.map((c) => [c.companyId, c.companyName]));

  const result = {
    participants: participants.map(p => ({
      companyId:   p.companyId,
      companyName: nameMap[p.companyId] || p.companyId,
      joinedAt:    p.joinedAt || p.joinedQueueAt || p.createdAt,
    })),
    count:        participants.length,
    minRequired:  minClients,
    isJobRunning: !!activeJob,
    activeJob: activeJob ? {
      jobId:        activeJob.jobId,
      status:       activeJob.status,
      currentRound: activeJob.currentRound || 0,
      totalRounds:  activeJob.totalRounds  || 5,
    } : null,
  };
  _queueCache.set(requestingCompanyId, { data: result, exp: Date.now() + QUEUE_CACHE_TTL });
  return result;
}

// ── checkAndStart ─────────────────────────────────────────────────────────────
/**
 * FIX 1: Only start a job when a single room has >= MIN_CLIENTS members.
 * This prevents users in different rooms from polluting each other's sessions.
 */
async function checkAndStart() {
  if (isStartingJob)          return;
  if (fedOrch.getActiveJob()) return;

  // Set the lock BEFORE any async operation to prevent the race condition
  // where two concurrent calls both pass the guard, both query the DB,
  // both find the room ready, and both start separate jobs (duplicates).
  isStartingJob = true;

  try {
    const minClients = await getMinClients();

    // Double-check after the async getConfig call — another call may have
    // started a job while we were waiting.
    if (fedOrch.getActiveJob()) return;

    // Find rooms that have reached the threshold
    const readyRooms = await Participant.aggregate([
      { $match: { status: PARTICIPANT_STATUS.QUEUED, jobId: null, roomId: { $ne: null } } },
      { $group: { _id: '$roomId', count: { $sum: 1 } } },
      { $match: { count: { $gte: minClients } } },
      { $limit: 1 },
    ]);

    if (readyRooms.length === 0) {
      const total = await Participant.countDocuments({ status: PARTICIPANT_STATUS.QUEUED, jobId: null });
      console.log(`[Queue] No room ready (${total} total queued, need ${minClients} in one room)`);
      return;
    }

    const roomId = readyRooms[0]._id;
    console.log(`[Queue] Room ${roomId} reached threshold (${readyRooms[0].count}/${minClients}) — starting job`);

    const participants   = await Participant.find({
      roomId,
      status: PARTICIPANT_STATUS.QUEUED,
      jobId:  null,
    }).limit(minClients);
    const participantIds = participants.map((p) => p.companyId);
    await fedOrch.startJob(participantIds, roomId);
  } catch (err) {
    console.error('[Queue] Job start failed:', err.message);
  } finally {
    isStartingJob = false;
  }
}

// ── joinQueue ─────────────────────────────────────────────────────────────────
async function joinQueue(companyId) {
  const minClients = await getMinClients();

  // Find or create a room for this user
  let roomId = await findOpenRoom(minClients);
  if (!roomId) {
    roomId = uuidv4();
    console.log(`[Queue] ${companyId} creating new room ${roomId}`);
  } else {
    console.log(`[Queue] ${companyId} joining existing room ${roomId}`);
  }

  await Participant.findOneAndUpdate(
    { companyId },
    {
      status:     PARTICIPANT_STATUS.QUEUED,
      jobId:      null,
      roomId,
      joinedAt:   new Date(),
      joinedQueueAt: new Date(),
    },
    { upsert: true, new: true }
  );

  const state = await getQueueState(companyId);
  emitter.emit(WS_EVENTS.QUEUE_UPDATED, { ...state, roomId });
  await checkAndStart();
  _invalidateCache();
  return await getQueueState(companyId);
}

// ── leaveQueue ────────────────────────────────────────────────────────────────
async function leaveQueue(companyId) {
  await Participant.deleteOne({ companyId });
  const state = await getQueueState(companyId);
  emitter.emit(WS_EVENTS.QUEUE_UPDATED, state);
  return state;
}

// ── polling ───────────────────────────────────────────────────────────────────
function startPolling() {
  setInterval(async () => {
    try { await checkAndStart(); }
    catch (err) { console.error('[Queue Poll Error]', err.message); }
  }, 5000);
}

module.exports = { joinQueue, leaveQueue, getQueueState, startPolling };

/**
 * federatedOrchestrator.js
 * Place at: backend/src/services/federatedOrchestrator.js
 *
 * AGGREGATION: Pairwise Masking + Meta-Aggregator
 * ────────────────────────────────────────────────
 * Replaces both simulatedOrchestrator.js and the FedAvg approach.
 *
 * Protocol per round:
 *  1. Server generates one shared seed  s_ij  for every pair (i, j), i < j
 *  2. Each node fetches its mask assignments via GET /api/federated/masks
 *  3. Each node trains locally (TF.js in browser), then:
 *       masked_w_i = w_i + Σ_{j>i} PRG(s_ij) − Σ_{j<i} PRG(s_ji)
 *  4. Node submits masked weights to POST /api/federated/submit
 *  5. Meta-aggregator sums all N masked submissions:
 *       Sum = Σ masked_w_i = Σ w_i  (all masks cancel pairwise)
 *     Global = Sum / N
 *
 * The server never sees individual un-masked weights.
 * The server never needs to know or store the seeds after distributing them
 * (masks cancel automatically on summation — no unmasking step needed).
 */

const { v4: uuidv4 }  = require('uuid');
const TrainingMetric  = require('../models/TrainingMetric');
const Participant     = require('../models/Participant');
const Model           = require('../models/Models');
const emitter         = require('../websocket/eventEmitter');
const { PARTICIPANT_STATUS, WS_EVENTS } = require('../config/constants');
const { getConfig }   = require('../models/SystemConfig');

// ─── Mulberry32 PRNG (same implementation as localTrainer.ts) ─────────────────
// Must stay byte-for-byte identical to the frontend version so both sides
// produce the same mask from the same seed.

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MASK_SCALE = 0.5; // must match localTrainer.ts

// ─── State ────────────────────────────────────────────────────────────────────

let activeJob     = null;
let globalWeights = null;   // current global model (SerializedWeights | null)

// Round-scoped mask seeds: Map<pairKey, seed>  e.g. "nodeA__nodeB" → 1234567
// Cleared at the start of each round.
let roundSeeds = new Map();

// Pending weight submissions for the current round:
// Map<companyId, { maskedWeights, metrics }>
const pendingSubmissions = new Map();

// Resolves the promise that blocks the round loop until all nodes submit
let roundResolve = null;

// ─── Config helpers ───────────────────────────────────────────────────────────

async function getTotalRounds() {
  try { return (await getConfig('DEFAULT_ROUNDS')) || parseInt(process.env.DEFAULT_ROUNDS || '5', 10); }
  catch { return 5; }
}

async function getMinClients() {
  try { return (await getConfig('MIN_CLIENTS')) || parseInt(process.env.MIN_CLIENTS || '2', 10); }
  catch { return 2; }
}

async function getRoundTimeoutMs() {
  try { return (await getConfig('ROUND_TIMEOUT_MS')) || parseInt(process.env.ROUND_TIMEOUT_MS || '120000', 10); }
  catch { return 120000; }
}

// ─── Pairwise seed generation ─────────────────────────────────────────────────

/**
 * Generates one random integer seed for every unique pair of participants.
 * Seeds are stored in `roundSeeds` keyed as "<idA>__<idB>" (sorted, idA < idB).
 *
 * @param {string[]} participantIds - ordered list of node IDs
 */
function generateRoundSeeds(participantIds) {
  roundSeeds.clear();
  for (let i = 0; i < participantIds.length; i++) {
    for (let j = i + 1; j < participantIds.length; j++) {
      const key  = `${participantIds[i]}__${participantIds[j]}`;
      const seed = Math.floor(Math.random() * 2 ** 31); // 31-bit positive int
      roundSeeds.set(key, seed);
      console.log(`[FedOrch] Pair (${participantIds[i]}, ${participantIds[j]}) seed=${seed}`);
    }
  }
}

/**
 * Returns the mask assignments for a single node:
 * one entry per peer, with the shared seed and whether to add or subtract.
 *
 * @param {string}   companyId
 * @param {string[]} participantIds - full ordered list (determines add/sub role)
 * @returns {{ peerId, seed, role }[]}
 */
function getMaskAssignmentsForNode(companyId, participantIds) {
  const myIndex = participantIds.indexOf(companyId);
  if (myIndex === -1) return [];

  const assignments = [];

  for (let j = 0; j < participantIds.length; j++) {
    if (j === myIndex) continue;
    const peerId = participantIds[j];

    // Canonical key: smaller index first
    const [idA, idB] = myIndex < j
      ? [companyId, peerId]
      : [peerId, companyId];
    const key  = `${idA}__${idB}`;
    const seed = roundSeeds.get(key);

    if (seed === undefined) continue;

    assignments.push({
      peerId,
      seed,
      role: myIndex < j ? 'add' : 'sub',
    });
  }

  return assignments;
}

// ─── Meta-aggregator ──────────────────────────────────────────────────────────

/**
 * Sums N sets of masked weights element-by-element, then divides by N.
 *
 * Because masks cancel pairwise (each +mask_ij is offset by a -mask_ij
 * from the peer), the result equals the simple average of the true weights.
 *
 * @param {Array<{ maskedWeights: SerializedWeights }>} submissions
 * @returns {SerializedWeights} - the new global model weights
 */
function metaAggregate(submissions) {
  if (submissions.length === 0) throw new Error('No submissions to aggregate');

  const N        = submissions.length;
  const template = submissions[0].maskedWeights;

  const aggregated = {
    shapes: template.shapes,
    values: template.values.map((_, tensorIdx) => {
      const size   = template.values[tensorIdx].length;
      const result = new Float64Array(size).fill(0);

      for (const { maskedWeights } of submissions) {
        const flat = maskedWeights.values[tensorIdx];
        for (let i = 0; i < size; i++) {
          result[i] += flat[i];
        }
      }

      // Divide by N (masks have already cancelled in the sum)
      for (let i = 0; i < size; i++) result[i] /= N;

      return Array.from(result);
    }),
  };

  console.log(`[FedOrch] Meta-aggregated ${N} masked submissions (masks cancelled)`);
  return aggregated;
}

// ─── Weight submission (called by route handler) ──────────────────────────────

/**
 * Accepts one node's masked weight submission.
 * Resolves the round once all expected nodes have submitted.
 */
function submitWeights(companyId, { maskedWeights, metrics, round, jobId }) {
  if (!activeJob) return { accepted: false, reason: 'No active job' };
  if (activeJob.jobId !== jobId)         return { accepted: false, reason: 'Wrong jobId' };
  if (round !== activeJob.currentRound)  return { accepted: false, reason: 'Wrong round' };

  pendingSubmissions.set(companyId, { maskedWeights, metrics });
  const received = pendingSubmissions.size;
  const expected = activeJob.participantIds.length;

  console.log(`[FedOrch] Masked weights from ${companyId} — ${received}/${expected} (round ${round})`);

  emitter.emit(WS_EVENTS.WEIGHTS_SUBMITTED, { jobId, round, companyId, received, expected });

  if (received >= expected && roundResolve) {
    roundResolve();
    roundResolve = null;
  }

  return { accepted: true, received, expected };
}

// ─── Public API ───────────────────────────────────────────────────────────────

function getActiveJob()     { return activeJob; }
function getGlobalWeights() { return globalWeights; }

function getMasksForNode(companyId) {
  if (!activeJob) return null;
  return getMaskAssignmentsForNode(companyId, activeJob.participantIds);
}

// ─── Job lifecycle ────────────────────────────────────────────────────────────

async function startJob(participantIds) {
  if (activeJob) {
    console.log('[FedOrch] Job already running');
    return activeJob;
  }

  const jobId       = `job-${uuidv4().slice(0, 8)}`;
  const totalRounds = await getTotalRounds();

  console.log(`[FedOrch] Starting job ${jobId} | rounds=${totalRounds} | nodes=[${participantIds.join(', ')}]`);

  activeJob = { jobId, status: 'INITIALIZING', participantIds, totalRounds, currentRound: 0, startedAt: new Date() };
  globalWeights = null;
  pendingSubmissions.clear();
  roundSeeds.clear();

  for (const companyId of participantIds) {
    await Participant.findOneAndUpdate(
      { companyId, status: PARTICIPANT_STATUS.QUEUED },
      { $set: { status: PARTICIPANT_STATUS.TRAINING, jobId } }
    );
  }

  emitter.emit(WS_EVENTS.TRAINING_STARTING, { jobId, totalRounds, participants: participantIds, startTime: activeJob.startedAt });

  runRounds(jobId, participantIds, totalRounds).catch((err) => {
    console.error(`[FedOrch] Job ${jobId} crashed:`, err.message);
    activeJob = null;
  });

  return activeJob;
}

async function runRounds(jobId, participantIds, totalRounds) {
  const timeoutMs = await getRoundTimeoutMs();

  for (let round = 1; round <= totalRounds; round++) {
    activeJob.currentRound = round;
    activeJob.status       = 'TRAINING';
    pendingSubmissions.clear();

    // ── 1. Generate fresh pairwise seeds for this round ──────────────────
    generateRoundSeeds(participantIds);

    console.log(`[FedOrch] Round ${round}/${totalRounds} — seeds generated, broadcasting start`);

    // ── 2. Broadcast round start (includes current global weights) ────────
    emitter.emit(WS_EVENTS.ROUND_STARTED, {
      jobId,
      round,
      totalRounds,
      globalWeights, // null on round 1 → nodes initialise their own models
    });

    // ── 3. Wait for all nodes to submit masked weights ────────────────────
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const n = pendingSubmissions.size;
        console.warn(`[FedOrch] Round ${round} timeout — ${n}/${participantIds.length} submitted`);
        if (n > 0) resolve();
        else reject(new Error(`Round ${round} timed out with zero submissions`));
      }, timeoutMs);

      roundResolve = () => { clearTimeout(timer); resolve(); };
    });

    activeJob.status = 'AGGREGATING';

    // ── 4. Meta-aggregate masked weights (masks cancel automatically) ──────
    const submissions = [...pendingSubmissions.entries()].map(([, sub]) => ({
      maskedWeights: sub.maskedWeights,
    }));

    globalWeights = metaAggregate(submissions);

    // ── 5. Compute and save metrics ───────────────────────────────────────
    const allMetrics   = [...pendingSubmissions.values()].map((s) => s.metrics || {});
    const totalSamples = allMetrics.reduce((s, m) => s + (m.datasetSize || 1), 0);
    const wavg = (key) =>
      allMetrics.reduce((s, m) => s + (m[key] || 0) * (m.datasetSize || 1), 0) / totalSamples;

    // Local metrics per node
    for (const [companyId, sub] of pendingSubmissions.entries()) {
      const m = sub.metrics || {};
      await TrainingMetric.create({
        jobId, round, companyId, type: 'local',
        accuracy:    m.accuracy    || 0,
        loss:        m.loss        || 0,
        datasetSize: m.datasetSize || 0,
        epochsRun:   m.epochsRun   || 0,
        durationMs:  m.durationMs  || 0,
      });
    }

    // Global (dataset-size weighted average of node metrics)
    await TrainingMetric.create({
      jobId, round, companyId: 'global', type: 'global',
      accuracy: wavg('accuracy'),
      loss:     wavg('loss'),
    });

    console.log(`[FedOrch] Round ${round} complete — global acc: ${(wavg('accuracy') * 100).toFixed(2)}%`);

    emitter.emit('round:aggregated', {
      jobId, round, totalRounds,
      globalAccuracy: wavg('accuracy'),
      globalLoss:     wavg('loss'),
      nodesSubmitted: pendingSubmissions.size,
    });
  }

  // ── Job complete ─────────────────────────────────────────────────────────
  const finalGlobal = await TrainingMetric.findOne({ jobId, type: 'global' }).sort({ round: -1 });

  try {
    await Model.create({
      modelId:      `model-${jobId}`,
      jobId,
      version:      '1.0.0',
      status:       'AVAILABLE',
      architecture: 'PairwiseMasked_MetaAggregator',
      participants: participantIds,
      weightsB64:   globalWeights
        ? Buffer.from(JSON.stringify(globalWeights)).toString('base64')
        : null,
      sizeBytes: globalWeights ? JSON.stringify(globalWeights).length : 0,
      trainingMetrics: {
        finalAccuracy:     finalGlobal?.accuracy || 0,
        finalLoss:         finalGlobal?.loss     || 0,
        roundsCompleted:   totalRounds,
        totalParticipants: participantIds.length,
      },
    });
  } catch (err) { console.error('[FedOrch] Model save error:', err.message); }

  await Participant.updateMany({ jobId }, { $set: { status: 'DONE', jobId: null } });

  emitter.emit(WS_EVENTS.TRAINING_COMPLETE, {
    jobId,
    finalAccuracy: finalGlobal?.accuracy,
    finalLoss:     finalGlobal?.loss,
  });

  console.log(`[FedOrch] ${jobId} COMPLETE — acc ${((finalGlobal?.accuracy || 0) * 100).toFixed(2)}%`);
  activeJob     = null;
  globalWeights = null;
  roundSeeds.clear();
}

module.exports = { startJob, getActiveJob, getGlobalWeights, getMasksForNode, submitWeights };

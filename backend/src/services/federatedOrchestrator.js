/**
 * federatedOrchestrator.js — backend/src/services/federatedOrchestrator.js
 *
 * Paper: "Privacy-Preserving IDS Using Federated Learning"
 * Implements Section 3.3 (Pairwise Masking) + Section 3.4 (Adaptive Meta-Aggregator)
 *
 * ══════════════════════════════════════════════════════════════════
 * PROTOCOL
 * ══════════════════════════════════════════════════════════════════
 *
 * PRIVACY LAYER — Pairwise Masking (Bonawitz et al., 2017):
 *   pair seed s_ij → client i adds PRG(s_ij), client j subtracts PRG(s_ij)
 *   Server: Σ(masked_i) = Σ(α_i × w_i + mask_i) = Σ(α_i × w_i)  [masks cancel]
 *
 * QUALITY LAYER — Adaptive Meta-Aggregator (Chen et al., 2020):
 *   Feature per client: [local_loss_norm, dataset_size_norm, update_consistency]
 *   Shared NN:  Linear(3→8, ReLU) → Linear(8→1) → score_i
 *   Softmax:    α_i = exp(score_i) / Σexp(score_j)    → Σα = 1
 *   Broadcast α to clients at round start (pre-scaling before masking)
 *   Server sums pre-scaled masked weights → Σ(α_i × w_i) = adaptive global model
 *
 * ONLINE LEARNING:
 *   REINFORCE: reward = Δglobal_accuracy per round
 *   Reinforce α that improved accuracy; pull toward uniform on drop
 * ══════════════════════════════════════════════════════════════════
 */

const { v4: uuidv4 }  = require('uuid');
const TrainingMetric  = require('../models/TrainingMetric');
const Participant     = require('../models/Participant');
const Model           = require('../models/Models');
const emitter         = require('../websocket/eventEmitter');
const { PARTICIPANT_STATUS, WS_EVENTS } = require('../config/constants');
const { getConfig }   = require('../models/SystemConfig');

// ─── Mulberry32 PRNG (identical to localTrainer.ts) ──────────────────────────
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const MASK_SCALE = 0.5;

// ─── Adaptive Meta-Aggregator NN (paper Section 3.4) ─────────────────────────
class AdaptiveMetaAggregator {
  /**
   * Per-client input features (paper Section 3.4):
   *   [0] local_loss_norm      — normalised local training loss
   *   [1] dataset_size_norm    — this client's share of total samples
   *   [2] update_consistency   — stability of weight updates across rounds
   *
   * Architecture:
   *   Shared encoder:  Linear(3→8, ReLU) → Linear(8→1) → scalar score
   *   Cross-client:    softmax(scores) → α_i, where Σα_i = 1
   *
   * Round 1: uniform α = 1/N (no quality signal yet)
   * Round t: NN refines α using quality signals from round t-1
   */
  constructor(lr = 0.05) {
    this.lr = lr;
    // He initialisation
    const he = (n) => (Math.random() * 2 - 1) * Math.sqrt(2 / n);
    this.W1 = Array.from({ length: 3 }, () => Array.from({ length: 8 }, () => he(3)));
    this.b1 = new Array(8).fill(0);
    this.W2 = Array.from({ length: 8 }, () => [he(8)]);
    this.b2 = [0.0];
    // State for REINFORCE
    this.prevAccuracy   = null;
    this.prevAlpha      = null;
    this.prevH          = null;  // stored hidden activations per client
    this.prevFeatures   = null;  // stored features per client
  }

  _relu(x)    { return Math.max(0, x); }
  _softmax(v) {
    const m   = Math.max(...v);
    const exp = v.map(x => Math.exp(x - m));
    const s   = exp.reduce((a, b) => a + b, 0);
    return exp.map(e => e / s);
  }

  /** Encode one client's feature vector → {h, score} */
  _encode(feat) {
    const h = this.b1.map((b, j) => {
      const z = feat.reduce((s, x, i) => s + x * this.W1[i][j], b);
      return this._relu(z);
    });
    const score = h.reduce((s, x, i) => s + x * this.W2[i][0], this.b2[0]);
    return { h, score };
  }

  /**
   * Compute per-client adaptive weights from quality signals.
   * @param {{ companyId, metrics }[]} clients
   * @returns {{ [companyId]: number }}  — softmax weights, sum = 1
   */
  computeWeights(clients) {
    if (clients.length === 0) return {};
    const totalSamples = clients.reduce((s, c) => s + (c.metrics?.datasetSize || 1), 0);

    const encoded = clients.map(({ companyId, metrics }) => {
      const loss        = Math.min(metrics.loss || 1.0, 5) / 5;
      const sizeNorm    = (metrics.datasetSize || 1) / totalSamples;
      const consistency = Math.max(0, Math.min(1, metrics.updateConsistency ?? 1.0));
      const feat        = [loss, sizeNorm, consistency];
      const { h, score } = this._encode(feat);
      return { companyId, feat, h, score };
    });

    const alphas = this._softmax(encoded.map(e => e.score));

    // Store for REINFORCE update
    this.prevAlpha    = alphas;
    this.prevH        = encoded.map(e => e.h);
    this.prevFeatures = encoded.map(e => e.feat);

    const weights = {};
    encoded.forEach(({ companyId }, i) => { weights[companyId] = alphas[i]; });
    return weights;
  }

  /**
   * REINFORCE online update after observing the round's accuracy.
   * If accuracy improved: reinforce current α distribution.
   * If accuracy dropped:  pull α toward uniform (more conservative).
   */
  learn(currentAccuracy) {
    if (this.prevAccuracy === null || !this.prevH || !this.prevAlpha) {
      this.prevAccuracy = currentAccuracy;
      return;
    }

    const reward = currentAccuracy - this.prevAccuracy;
    if (Math.abs(reward) < 1e-7) { this.prevAccuracy = currentAccuracy; return; }

    const N = this.prevAlpha.length;

    for (let ci = 0; ci < N; ci++) {
      const h     = this.prevH[ci];
      const feat  = this.prevFeatures[ci];
      const alpha = this.prevAlpha[ci];

      // REINFORCE gradient: ∂J/∂score_i = reward × (1 − α_i)
      const dScore = this.lr * reward * (1 - alpha);

      // Update output layer
      for (let j = 0; j < 8; j++) this.W2[j][0] += dScore * h[j];
      this.b2[0] += dScore;

      // Backprop through ReLU into hidden layer
      for (let j = 0; j < 8; j++) {
        if (h[j] <= 0) continue;                    // ReLU gate
        const dH = dScore * this.W2[j][0];
        for (let k = 0; k < 3; k++) this.W1[k][j] += dH * feat[k];
        this.b1[j] += dH;
      }
    }

    this.prevAccuracy = currentAccuracy;
  }
}

// ─── In-memory state ──────────────────────────────────────────────────────────
let activeJob            = null;
let globalWeights        = null;
let roundSeeds           = new Map();
let adaptiveWeightsNext  = {};   // α for the upcoming round
let metaAggregator       = null;
const pendingSubmissions = new Map();
let roundResolve         = null;

// ─── Config ───────────────────────────────────────────────────────────────────
async function getTotalRounds() {
  try { return (await getConfig('DEFAULT_ROUNDS')) || parseInt(process.env.DEFAULT_ROUNDS || '5', 10); }
  catch { return 5; }
}
async function getMinClients() {
  try { return (await getConfig('MIN_CLIENTS')) || parseInt(process.env.MIN_CLIENTS || '2', 10); }
  catch { return 2; }
}
async function getRoundTimeoutMs() {
  try { return (await getConfig('ROUND_TIMEOUT_MS')) || parseInt(process.env.ROUND_TIMEOUT_MS || '600000', 10); }
  catch { return 600000; }
}

// ─── Pairwise masking ─────────────────────────────────────────────────────────
function generateRoundSeeds(participantIds) {
  roundSeeds.clear();
  for (let i = 0; i < participantIds.length; i++) {
    for (let j = i + 1; j < participantIds.length; j++) {
      const key  = `${participantIds[i]}__${participantIds[j]}`;
      const seed = Math.floor(Math.random() * 2 ** 31);
      roundSeeds.set(key, seed);
      console.log(`[FedOrch] Pair (${participantIds[i]}, ${participantIds[j]}) seed=${seed}`);
    }
  }
}

function getMaskAssignmentsForNode(companyId, participantIds) {
  const myIdx = participantIds.indexOf(companyId);
  if (myIdx === -1) return [];
  return participantIds.flatMap((peerId, j) => {
    if (j === myIdx) return [];
    const [idA, idB] = myIdx < j ? [companyId, peerId] : [peerId, companyId];
    const seed = roundSeeds.get(`${idA}__${idB}`);
    if (seed === undefined) return [];
    return [{ peerId, seed, role: myIdx < j ? 'add' : 'sub' }];
  });
}

// ─── Submit weights ───────────────────────────────────────────────────────────
function submitWeights(companyId, { maskedWeights, metrics, round, jobId }) {
  if (!activeJob)                       return { accepted: false, reason: 'No active job' };
  if (activeJob.jobId !== jobId)        return { accepted: false, reason: 'Wrong jobId' };
  if (round !== activeJob.currentRound) return { accepted: false, reason: 'Wrong round' };

  pendingSubmissions.set(companyId, { maskedWeights, metrics });
  const received = pendingSubmissions.size;
  const expected = activeJob.participantIds.length;

  console.log(`[FedOrch] Masked weights from ${companyId} — ${received}/${expected} (round ${round})`);
  emitter.emit(WS_EVENTS.WEIGHTS_SUBMITTED, { jobId, round, companyId, received, expected });

  if (received >= expected && roundResolve) { roundResolve(); roundResolve = null; }
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
  if (activeJob) { console.log('[FedOrch] Job already running'); return activeJob; }

  const jobId       = `job-${uuidv4().slice(0, 8)}`;
  const totalRounds = await getTotalRounds();

  console.log(`[FedOrch] Starting job ${jobId} | rounds=${totalRounds} | nodes=[${participantIds.join(', ')}]`);

  activeJob          = { jobId, status: 'INITIALIZING', participantIds, totalRounds, currentRound: 0, startedAt: new Date(), adaptiveWeights: null };
  globalWeights      = null;
  metaAggregator     = new AdaptiveMetaAggregator();
  pendingSubmissions.clear();
  roundSeeds.clear();

  // Round 1: uniform weights (1/N) — no quality signal yet
  const uniformAlpha = 1 / participantIds.length;
  adaptiveWeightsNext = Object.fromEntries(participantIds.map(id => [id, uniformAlpha]));

  for (const companyId of participantIds) {
    await Participant.findOneAndUpdate(
      { companyId, status: PARTICIPANT_STATUS.QUEUED },
      { $set: { status: PARTICIPANT_STATUS.TRAINING, jobId } }
    );
  }

  emitter.emit(WS_EVENTS.TRAINING_STARTING, { jobId, totalRounds, participants: participantIds });
  runRounds(jobId, participantIds, totalRounds).catch(err => {
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

    generateRoundSeeds(participantIds);

    // ── Compute and store adaptive weights for this round ─────────────────────
    // FIX: store alphaThisRound on activeJob so that socketHandler.js can
    // include it in the replay sent to reconnecting clients.  Without this,
    // replayed round:started events arrive without adaptiveWeights and clients
    // fall back to uniform α, which gives incorrect weight scaling in rounds 2+.
    const alphaThisRound = { ...adaptiveWeightsNext };
    activeJob.adaptiveWeights = alphaThisRound;

    console.log(
      `[FedOrch] Round ${round}/${totalRounds} | α=[` +
      Object.entries(alphaThisRound).map(([id, a]) => `${id}:${a.toFixed(3)}`).join(', ') + ']'
    );

    emitter.emit(WS_EVENTS.ROUND_STARTED, {
      jobId, round, totalRounds,
      globalWeights,
      adaptiveWeights: alphaThisRound,
    });

    // ── Wait for all submissions ────────────────────────────────────────────────
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const n = pendingSubmissions.size;
        if (n > 0) resolve();
        else reject(new Error(`Round ${round} timed out with zero submissions`));
      }, timeoutMs);
      roundResolve = () => { clearTimeout(timer); resolve(); };
    });

    activeJob.status = 'AGGREGATING';

    // ── Aggregate (paper Section 3.4) ─────────────────────────────────────────
    const submissions = [...pendingSubmissions.values()];
    const template    = submissions[0].maskedWeights;

    globalWeights = {
      shapes: template.shapes,
      values: template.values.map((_, tIdx) => {
        const size   = template.values[tIdx].length;
        const result = new Float64Array(size).fill(0);
        for (const { maskedWeights } of submissions) {
          const flat = maskedWeights.values[tIdx];
          for (let i = 0; i < size; i++) result[i] += flat[i];
        }
        return Array.from(result);
      }),
    };

    // ── Quality metrics ────────────────────────────────────────────────────────
    const allM         = submissions.map(s => s.metrics || {});
    const totalSamples = allM.reduce((s, m) => s + (m.datasetSize || 1), 0);
    const wavg         = (k) => allM.reduce((s, m) => s + (m[k] || 0) * (m.datasetSize || 1), 0) / totalSamples;
    const globalAcc    = wavg('accuracy');
    const globalLoss   = wavg('loss');

    // ── Meta-NN online learning ────────────────────────────────────────────────
    metaAggregator.learn(globalAcc);

    // ── Compute adaptive weights for NEXT round ────────────────────────────────
    const clientData = [...pendingSubmissions.entries()].map(([companyId, sub]) => ({
      companyId, metrics: sub.metrics || {},
    }));
    adaptiveWeightsNext = metaAggregator.computeWeights(clientData);

    console.log(
      `[MetaAgg] Round ${round} complete | acc=${(globalAcc*100).toFixed(2)}% | ` +
      `Next-round α=[${Object.entries(adaptiveWeightsNext).map(([id,a])=>`${id}:${a.toFixed(3)}`).join(', ')}]`
    );

    // ── Save metrics ───────────────────────────────────────────────────────────
    for (const [companyId, sub] of pendingSubmissions.entries()) {
      const m = sub.metrics || {};
      await TrainingMetric.create({
        jobId, round, companyId, type: 'local',
        accuracy: m.accuracy || 0, loss: m.loss || 0,
        datasetSize: m.datasetSize || 0, epochsRun: m.epochsRun || 0, durationMs: m.durationMs || 0,
        adaptiveWeight: alphaThisRound[companyId] || (1 / participantIds.length),
      });
    }
    await TrainingMetric.create({ jobId, round, companyId: 'global', type: 'global', accuracy: globalAcc, loss: globalLoss });

    emitter.emit('round:aggregated', {
      jobId, round, totalRounds, globalAccuracy: globalAcc, globalLoss,
      nodesSubmitted: pendingSubmissions.size,
      adaptiveWeights: alphaThisRound,
      nextRoundWeights: adaptiveWeightsNext,
    });
  }

  // ── Finalise ──────────────────────────────────────────────────────────────────
  const finalGlobal = await TrainingMetric.findOne({ jobId, type: 'global' }).sort({ round: -1 });

  try {
    await Model.create({
      modelId: `model-${jobId}`, jobId, version: '1.0.0', status: 'AVAILABLE',
      architecture: 'PairwiseMasking_AdaptiveMetaAggregator',
      participants: participantIds,
      weightsB64: globalWeights ? Buffer.from(JSON.stringify(globalWeights)).toString('base64') : null,
      sizeBytes:  globalWeights ? JSON.stringify(globalWeights).length : 0,
      trainingMetrics: {
        finalAccuracy: finalGlobal?.accuracy || 0, finalLoss: finalGlobal?.loss || 0,
        roundsCompleted: activeJob?.totalRounds || 0, totalParticipants: participantIds.length,
      },
    });
  } catch (err) { console.error('[FedOrch] Model save error:', err.message); }

  await Participant.updateMany({ jobId }, { $set: { status: 'DONE', jobId: null } });
  emitter.emit(WS_EVENTS.TRAINING_COMPLETE, { jobId, finalAccuracy: finalGlobal?.accuracy, finalLoss: finalGlobal?.loss });
  console.log(`[FedOrch] ${jobId} COMPLETE — acc ${((finalGlobal?.accuracy||0)*100).toFixed(2)}%`);

  activeJob = null; globalWeights = null; metaAggregator = null; roundSeeds.clear();
}

module.exports = { startJob, getActiveJob, getGlobalWeights, getMasksForNode, submitWeights };

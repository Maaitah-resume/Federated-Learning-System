// Simulated FL orchestrator — runs entirely in Node.js for demo purposes
// Replace with real pythonBridge integration when Python FL server is deployed
const { v4: uuidv4 } = require('uuid');
const TrainingMetric = require('../models/TrainingMetric');
const Participant    = require('../models/Participant');
const Models         = require('../models/Models');
const emitter        = require('../websocket/eventEmitter');
const { PARTICIPANT_STATUS, WS_EVENTS } = require('../config/constants');
const { DEFAULT_ROUNDS } = require('../config/env');

let activeJob = null;

function getActiveJob() { return activeJob; }

// Realistic metric trajectory: accuracy improves from ~0.55 to ~0.92, loss from ~0.85 to ~0.18
function metricsForRound(round, totalRounds, jitter = 0) {
  const progress  = round / totalRounds;
  const accuracy  = 0.55 + 0.37 * (1 - Math.exp(-2.5 * progress)) + jitter;
  const loss      = 0.85 * Math.exp(-2.0 * progress) + 0.05 + jitter * -0.5;
  const f1Score   = accuracy - 0.02 + jitter * 0.5;
  const precision = accuracy + 0.01 + jitter * 0.3;
  const recall    = accuracy - 0.01 + jitter * 0.4;
  return {
    accuracy:  Math.min(0.99, Math.max(0, accuracy)),
    loss:      Math.max(0.01, loss),
    f1Score:   Math.min(0.99, Math.max(0, f1Score)),
    precision: Math.min(0.99, Math.max(0, precision)),
    recall:    Math.min(0.99, Math.max(0, recall)),
  };
}

async function startJob(participantIds) {
  const jobId       = `job-${uuidv4().slice(0, 8)}`;
  const totalRounds = DEFAULT_ROUNDS || 10;

  console.log(`[SimOrchestrator] Starting job ${jobId} for [${participantIds.join(', ')}]`);

  activeJob = {
    jobId,
    status: 'INITIALIZING',
    participantIds,
    totalRounds,
    currentRound: 0,
    startedAt: new Date(),
  };

  // Move participants from QUEUED to TRAINING and assign jobId
  await Participant.updateMany(
    { companyId: { $in: participantIds }, status: PARTICIPANT_STATUS.QUEUED },
    { $set: { status: PARTICIPANT_STATUS.TRAINING, jobId } }
  );

  emitter.emit(WS_EVENTS.TRAINING_STARTING, {
    jobId, totalRounds, participants: participantIds, startTime: activeJob.startedAt,
  });

  // Run rounds asynchronously — don't block the join request
  runRounds(jobId, participantIds, totalRounds).catch((err) => {
    console.error(`[SimOrchestrator] Job ${jobId} crashed:`, err.message);
  });

  return activeJob;
}

async function runRounds(jobId, participantIds, totalRounds) {
  const ROUND_DURATION_MS = 4000; // 4s per round = ~40s total for 10 rounds

  for (let round = 1; round <= totalRounds; round++) {
    activeJob.currentRound = round;
    activeJob.status = 'TRAINING';

    emitter.emit(WS_EVENTS.ROUND_STARTED, { jobId, round, totalRounds });
    console.log(`[SimOrchestrator] ${jobId} — Round ${round}/${totalRounds} starting`);

    // Simulate per-participant local training
    const startTs = Date.now();
    for (const companyId of participantIds) {
      // Each participant gets slightly different metrics (non-IID realism)
      const jitter = (Math.random() - 0.5) * 0.04;
      const m = metricsForRound(round, totalRounds, jitter);

      await TrainingMetric.create({
        jobId, round, companyId, type: 'local',
        accuracy:    m.accuracy,
        loss:        m.loss,
        f1Score:     m.f1Score,
        precision:   m.precision,
        recall:      m.recall,
        datasetSize: 1000 + Math.floor(Math.random() * 200),
        epochsRun:   3,
        durationMs:  ROUND_DURATION_MS - Math.floor(Math.random() * 500),
      });
    }

    // Wait for "training" to complete
    await new Promise((r) => setTimeout(r, ROUND_DURATION_MS));

    // Save aggregated global metric (FedAvg simulation: average of locals + small boost)
    const localsThisRound = await TrainingMetric.find({ jobId, round, type: 'local' });
    const avg = (key) => localsThisRound.reduce((s, x) => s + (x[key] || 0), 0) / localsThisRound.length;

    await TrainingMetric.create({
      jobId, round, companyId: 'global', type: 'global',
      accuracy:  avg('accuracy')  + 0.005,
      loss:      avg('loss')      - 0.003,
      f1Score:   avg('f1Score')   + 0.005,
      precision: avg('precision') + 0.005,
      recall:    avg('recall')    + 0.005,
    });

    activeJob.status = 'AGGREGATING';
    console.log(`[SimOrchestrator] ${jobId} — Round ${round} aggregated`);
  }

  // Job complete
  const finalGlobal = await TrainingMetric.findOne({ jobId, type: 'global' }).sort({ round: -1 });

  await Models.create({
    modelId:      `model-${jobId}`,
    jobId,
    name:         `Global_Model_${jobId.slice(-8)}`,
    version:      `v${Date.now()}`,
    rounds:       totalRounds,
    accuracy:     finalGlobal.accuracy,
    loss:         finalGlobal.loss,
    participants: participantIds,
    createdAt:    new Date(),
  }).catch(() => {});  // ignore if Models schema missing fields

  // Reset participants
  await Participant.updateMany(
    { jobId },
    { $set: { status: PARTICIPANT_STATUS.COMPLETED, jobId: null } }
  );

  emitter.emit(WS_EVENTS.TRAINING_COMPLETE, { jobId, finalAccuracy: finalGlobal.accuracy });
  console.log(`[SimOrchestrator] ${jobId} COMPLETE — final accuracy ${(finalGlobal.accuracy * 100).toFixed(2)}%`);

  activeJob = null;
}

module.exports = { startJob, getActiveJob };

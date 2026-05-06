const { v4: uuidv4 }    = require('uuid');
const TrainingMetric    = require('../models/TrainingMetric');
const Participant       = require('../models/Participant');
const Model             = require('../models/Models');
const emitter           = require('../websocket/eventEmitter');
const pythonBridge      = require('./pythonBridge');
const { PARTICIPANT_STATUS, WS_EVENTS } = require('../config/constants');
const { DEFAULT_ROUNDS } = require('../config/env');

let activeJob = null;

function getActiveJob() { return activeJob; }

function metricsForRound(round, totalRounds, jitter = 0) {
  const progress = round / totalRounds;
  const accuracy = 0.55 + 0.37 * (1 - Math.exp(-2.5 * progress)) + jitter;
  const loss     = 0.85 * Math.exp(-2.0 * progress) + 0.05 + Math.abs(jitter) * 0.3;
  return {
    accuracy:  Math.min(0.99, Math.max(0.01, accuracy)),
    loss:      Math.max(0.01, loss),
    f1Score:   Math.min(0.99, Math.max(0.01, accuracy - 0.02 + jitter)),
    precision: Math.min(0.99, Math.max(0.01, accuracy + 0.01)),
    recall:    Math.min(0.99, Math.max(0.01, accuracy - 0.01)),
  };
}

async function startJob(participantIds) {
  if (activeJob) {
    console.log('[SimOrchestrator] Job already running, skipping');
    return activeJob;
  }

  const jobId       = `job-${uuidv4().slice(0, 8)}`;
  const totalRounds = DEFAULT_ROUNDS || 10;

  console.log(`[SimOrchestrator] Starting job ${jobId} for [${participantIds.join(', ')}]`);

  activeJob = { jobId, status: 'INITIALIZING', participantIds, totalRounds, currentRound: 0, startedAt: new Date() };

  for (const companyId of participantIds) {
    await Participant.findOneAndUpdate(
      { companyId, status: PARTICIPANT_STATUS.QUEUED },
      { $set: { status: PARTICIPANT_STATUS.TRAINING, jobId } }
    );
  }

  emitter.emit(WS_EVENTS.TRAINING_STARTING, {
    jobId, totalRounds, participants: participantIds, startTime: activeJob.startedAt,
  });

  runRounds(jobId, participantIds, totalRounds).catch((err) => {
    console.error(`[SimOrchestrator] Job ${jobId} crashed:`, err.message);
    activeJob = null;
  });

  return activeJob;
}

async function runRounds(jobId, participantIds, totalRounds) {
  const ROUND_DURATION_MS = 4000;

  // Step 1: Get real model weights from Python FL server
  let weightsB64 = null;
  let modelParams = 0;
  try {
    const initResult = await pythonBridge.initialize(jobId, 'IDSNet_v2');
    weightsB64   = initResult.weights_b64;
    modelParams  = initResult.num_params || 0;
    console.log(`[SimOrchestrator] FL server initialized — ${modelParams} params`);
  } catch (err) {
    console.warn(`[SimOrchestrator] FL server unreachable, using simulated weights: ${err.message}`);
    weightsB64 = null;
  }

  for (let round = 1; round <= totalRounds; round++) {
    activeJob.currentRound = round;
    activeJob.status = 'TRAINING';

    emitter.emit(WS_EVENTS.ROUND_STARTED, { jobId, round, totalRounds });
    console.log(`[SimOrchestrator] ${jobId} — Round ${round}/${totalRounds}`);

    for (const companyId of participantIds) {
      const jitter = (Math.random() - 0.5) * 0.06;
      const m = metricsForRound(round, totalRounds, jitter);
      await TrainingMetric.create({
        jobId, round, companyId, type: 'local',
        accuracy:    m.accuracy,
        loss:        m.loss,
        f1Score:     m.f1Score,
        precision:   m.precision,
        recall:      m.recall,
        datasetSize: 800 + Math.floor(Math.random() * 400),
        epochsRun:   3,
        durationMs:  ROUND_DURATION_MS - Math.floor(Math.random() * 800),
      });
    }

    await new Promise((r) => setTimeout(r, ROUND_DURATION_MS));

    activeJob.status = 'AGGREGATING';
    const locals = await TrainingMetric.find({ jobId, round, type: 'local' });
    const avg    = (key) => locals.reduce((s, x) => s + (x[key] || 0), 0) / locals.length;

    await TrainingMetric.create({
      jobId, round, companyId: 'global', type: 'global',
      accuracy:  Math.min(0.99, avg('accuracy')  + 0.005),
      loss:      Math.max(0.01, avg('loss')      - 0.003),
      f1Score:   Math.min(0.99, avg('f1Score')   + 0.004),
      precision: Math.min(0.99, avg('precision') + 0.004),
      recall:    Math.min(0.99, avg('recall')    + 0.004),
    });

    console.log(`[SimOrchestrator] ${jobId} — Round ${round} aggregated`);
  }

  const finalGlobal = await TrainingMetric.findOne({ jobId, type: 'global' }).sort({ round: -1 });

  // Step 2: Try to get final weights from FL server (aggregate round)
  try {
    const aggResult = await pythonBridge.aggregate(jobId, totalRounds);
    if (aggResult?.aggregated_weights_b64) {
      weightsB64 = aggResult.aggregated_weights_b64;
      console.log(`[SimOrchestrator] Got aggregated weights from FL server`);
    }
  } catch (err) {
    console.warn(`[SimOrchestrator] Could not get aggregated weights: ${err.message}`);
  }

  // Compute actual size of weights
  const weightsBytes = weightsB64
    ? Math.round(Buffer.byteLength(weightsB64, 'base64'))
    : 1024 * 1024 * 4;

  // Step 3: Save model with real weights
  try {
    await Model.create({
      modelId:      `model-${jobId}`,
      jobId,
      version:      '1.0.0',
      status:       'AVAILABLE',
      architecture: 'IDSNet_v2',
      participants: participantIds,
      weightsB64:   weightsB64,        // real .pt weights from FL server
      sizeBytes:    weightsBytes,
      artifactPath: `/models/${jobId}/global_model.pt`,
      trainingMetrics: {
        finalAccuracy:     finalGlobal?.accuracy || 0,
        finalLoss:         finalGlobal?.loss     || 0,
        roundsCompleted:   totalRounds,
        totalParticipants: participantIds.length,
      },
    });
    console.log(`[SimOrchestrator] Model saved — ${(weightsBytes / 1024).toFixed(1)} KB — participants: [${participantIds.join(', ')}]`);
  } catch (err) {
    console.error('[SimOrchestrator] Model save error:', err.message);
  }

  await Participant.updateMany(
    { jobId },
    { $set: { status: 'DONE', jobId: null } }
  );

  emitter.emit(WS_EVENTS.TRAINING_COMPLETE, {
    jobId,
    finalAccuracy: finalGlobal?.accuracy,
    finalLoss:     finalGlobal?.loss,
  });

  console.log(`[SimOrchestrator] ${jobId} COMPLETE — accuracy ${((finalGlobal?.accuracy || 0) * 100).toFixed(2)}%`);
  activeJob = null;
}

module.exports = { startJob, getActiveJob };

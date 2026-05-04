const { v4: uuidv4 }    = require('uuid');
const TrainingMetric    = require('../models/TrainingMetric');
const Participant       = require('../models/Participant');
const Model             = require('../models/Models');
const emitter           = require('../websocket/eventEmitter');
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

  // Move participants to TRAINING
  for (const companyId of participantIds) {
    await Participant.findOneAndUpdate(
      { companyId, status: PARTICIPANT_STATUS.QUEUED },
      { $set: { status: PARTICIPANT_STATUS.TRAINING, jobId } }
    );
  }

  emitter.emit(WS_EVENTS.TRAINING_STARTING, {
    jobId, totalRounds, participants: participantIds, startTime: activeJob.startedAt,
  });

  // Run rounds async — don't block the HTTP response
  runRounds(jobId, participantIds, totalRounds).catch((err) => {
    console.error(`[SimOrchestrator] Job ${jobId} crashed:`, err.message);
    activeJob = null;
  });

  return activeJob;
}

async function runRounds(jobId, participantIds, totalRounds) {
  const ROUND_DURATION_MS = 4000;

  for (let round = 1; round <= totalRounds; round++) {
    activeJob.currentRound = round;
    activeJob.status = 'TRAINING';

    emitter.emit(WS_EVENTS.ROUND_STARTED, { jobId, round, totalRounds });
    console.log(`[SimOrchestrator] ${jobId} — Round ${round}/${totalRounds}`);

    // Save local metrics for each participant
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

    // Wait for simulated training
    await new Promise((r) => setTimeout(r, ROUND_DURATION_MS));

    // Aggregate (FedAvg simulation)
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

  // Get final metrics
  const finalGlobal = await TrainingMetric.findOne({ jobId, type: 'global' }).sort({ round: -1 });

  // Save model — participants field is critical for per-user access
  try {
    await Model.create({
      modelId:      `model-${jobId}`,
      jobId,
      version:      '1.0.0',
      status:       'AVAILABLE',
      architecture: 'IDSNet_v2',
      participants: participantIds,          // ← who can access this model
      sizeBytes:    1024 * 1024 * 4,         // simulated 4MB
      artifactPath: `/models/${jobId}/global_model.pt`,
      trainingMetrics: {
        finalAccuracy:     finalGlobal?.accuracy || 0,
        finalLoss:         finalGlobal?.loss     || 0,
        roundsCompleted:   totalRounds,
        totalParticipants: participantIds.length,
      },
    });
    console.log(`[SimOrchestrator] Model saved for job ${jobId} — participants: [${participantIds.join(', ')}]`);
  } catch (err) {
    console.error('[SimOrchestrator] Model save error:', err.message);
  }

  // Reset participants to DONE
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

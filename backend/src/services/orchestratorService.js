// src/services/orchestratorService.js
const { v4: uuidv4 }  = require('uuid');
const jobManager      = require('./jobManager');
const pythonBridge    = require('./pythonBridge');
const modelRegistry   = require('./modelRegistry');
const Participant     = require('../models/Participant');
const emitter         = require('../websocket/eventEmitter');
const { JOB_STATUS, PARTICIPANT_STATUS, WS_EVENTS } = require('../config/constants');
const { DEFAULT_ROUNDS, MIN_CLIENTS, ROUND_TIMEOUT_MINUTES } = require('../config/env');

// In-memory weight buffer: { [jobId]: { [companyId]: { weightsB64, datasetSize } } }
const weightBuffer = {};

// Active round timeout timers: { [jobId]: timeoutHandle }
const roundTimers = {};

// ─── Start a new training job ─────────────────────────────────────────────────

/**
 * Called by queueService once MIN_CLIENTS are in the queue.
 * Creates the job, moves participants in, initialises the model, starts round 1.
 */
async function startJob(participantIds) {
  console.log(`[Orchestrator] Starting job for participants: ${participantIds.join(', ')}`);

  // 1. Create the job record in MongoDB
  const job = await jobManager.createJob(participantIds, {
    totalRounds:    DEFAULT_ROUNDS,
    minParticipants: MIN_CLIENTS,
  });

  // 2. Notify all browsers that training is starting
  emitter.emit(WS_EVENTS.TRAINING_STARTING, {
    jobId:       job.jobId,
    totalRounds: job.totalRounds,
    participants: participantIds,
    startTime:   new Date(),
  });

  // 3. Initialise the global model via Python FL service
  await jobManager.updateJobStatus(job.jobId, JOB_STATUS.INITIALIZING);

  let initResult;
  try {
    initResult = await pythonBridge.initialize(job.jobId, 'IDSNet_v2');
  } catch (err) {
    await _failJob(job.jobId, `Model initialisation failed: ${err.message}`);
    return;
  }

  console.log(`[Orchestrator] Model initialised for job ${job.jobId}`);

  // 4. Update job with model version and move to first round
  await jobManager.updateJobStatus(job.jobId, JOB_STATUS.ROUND_IN_PROGRESS, {
    globalModelVersion: initResult.model_architecture || 'IDSNet_v2',
    currentRound: 1,
  });

  // 5. Start round 1
  await _startRound(job.jobId, 1, participantIds);
}

// ─── Start a round ────────────────────────────────────────────────────────────

async function _startRound(jobId, roundNumber, participantIds) {
  console.log(`[Orchestrator] Starting round ${roundNumber} for job ${jobId}`);

  // Create the round record
  await jobManager.createRound(jobId, roundNumber, participantIds);

  // Initialise the weight buffer for this round
  weightBuffer[jobId] = {};

  // Notify clients that a new round has started
  emitter.emit(WS_EVENTS.ROUND_STARTED, {
    jobId,
    round:          roundNumber,
    modelAvailable: true,
  });

  // Set a round timeout — if not all weights arrive, proceed with what we have
  _setRoundTimeout(jobId, roundNumber, participantIds);
}

// ─── Receive weights from a company ──────────────────────────────────────────

/**
 * Called by the training route when a company submits their local weights.
 * Buffers the weights and triggers aggregation when all have arrived.
 */
async function receiveWeights(jobId, companyId, weightsB64, datasetSize, roundNumber) {
  if (!weightBuffer[jobId]) weightBuffer[jobId] = {};

  weightBuffer[jobId][companyId] = { weightsB64, datasetSize: datasetSize || 0 };

  const job   = await jobManager.getJobById(jobId);
  const round = await jobManager.getRound(jobId, roundNumber);

  const submittedCount = Object.keys(weightBuffer[jobId]).length;
  const expectedCount  = round.participantsExpected.length;

  console.log(`[Orchestrator] Weights received from ${companyId} — ${submittedCount}/${expectedCount} for round ${roundNumber}`);

  // Broadcast progress to all browsers
  emitter.emit(WS_EVENTS.WEIGHTS_RECEIVED, {
    jobId,
    round:    roundNumber,
    received: submittedCount,
    total:    expectedCount,
  });

  // All expected weights received — aggregate immediately
  if (submittedCount >= expectedCount) {
    _clearRoundTimeout(jobId);
    await _aggregateRound(jobId, roundNumber);
  }
}

// ─── Aggregate a round ────────────────────────────────────────────────────────

async function _aggregateRound(jobId, roundNumber) {
  console.log(`[Orchestrator] Aggregating round ${roundNumber} for job ${jobId}`);

  const job = await jobManager.getJobById(jobId);
  await jobManager.updateJobStatus(jobId, JOB_STATUS.AGGREGATING);

  // Build the weights array for Python
  const weightsArray = Object.entries(weightBuffer[jobId] || {}).map(
    ([companyId, { weightsB64, datasetSize }]) => ({ companyId, weightsB64, datasetSize })
  );

  let aggregationResult;
  try {
    aggregationResult = await pythonBridge.aggregate(jobId, roundNumber);
  } catch (err) {
    await _failJob(jobId, `Aggregation failed on round ${roundNumber}: ${err.message}`);
    return;
  }

  // Clear the weight buffer for this job
  delete weightBuffer[jobId];

  const metrics = aggregationResult.metrics || {};

  // Mark the round complete in MongoDB
  await jobManager.markRoundComplete(jobId, roundNumber, {
    avgLoss:             metrics.avg_loss,
    accuracyDelta:       metrics.delta_accuracy,
    aggregationStrategy: 'fedavg',
  });

  // Notify browsers the round finished
  emitter.emit(WS_EVENTS.ROUND_COMPLETE, {
    jobId,
    round:   roundNumber,
    metrics: {
      loss: metrics.avg_loss,
      acc:  metrics.delta_accuracy,
    },
  });

  console.log(`[Orchestrator] Round ${roundNumber} complete. Metrics:`, metrics);

  // ── Decide: next round or finalise ───────────────────────────────────────
  if (roundNumber < job.totalRounds) {
    const nextRound = roundNumber + 1;

    await jobManager.updateJobStatus(jobId, JOB_STATUS.ROUND_IN_PROGRESS, {
      currentRound: nextRound,
    });

    await _startRound(jobId, nextRound, job.participantIds);

  } else {
    await _finaliseJob(jobId);
  }
}

// ─── Finalise job ─────────────────────────────────────────────────────────────

async function _finaliseJob(jobId) {
  console.log(`[Orchestrator] Finalising job ${jobId}`);

  await jobManager.updateJobStatus(jobId, JOB_STATUS.FINALIZING);

  let finalResult;
  try {
    finalResult = await pythonBridge.finalize(jobId);
  } catch (err) {
    await _failJob(jobId, `Finalisation failed: ${err.message}`);
    return;
  }

  // Register the model artefact
  const model = await modelRegistry.register(jobId, finalResult.model_path, {
    checksum:  finalResult.checksum,
    sizeBytes: finalResult.size_bytes,
  });

  // Mark job complete
  await jobManager.markJobComplete(jobId, model._id);

  // Mark all participants done
  await Participant.updateMany(
    { jobId },
    { $set: { status: PARTICIPANT_STATUS.DONE } }
  );

  console.log(`[Orchestrator] Job ${jobId} complete. Model: ${model.modelId}`);

  // Notify all browsers — training is done, model is ready
  emitter.emit(WS_EVENTS.TRAINING_COMPLETE, {
    jobId,
    modelId:     model.modelId,
    downloadUrl: `/api/models/${model.modelId}/download`,
  });
}

// ─── Fail job ─────────────────────────────────────────────────────────────────

async function _failJob(jobId, reason) {
  console.error(`[Orchestrator] Job ${jobId} failed: ${reason}`);

  _clearRoundTimeout(jobId);
  delete weightBuffer[jobId];

  await jobManager.markJobFailed(jobId, reason);

  emitter.emit(WS_EVENTS.TRAINING_ERROR, {
    jobId,
    code:    'JOB_FAILED',
    message: reason,
  });
}

// ─── Round timeout ────────────────────────────────────────────────────────────

function _setRoundTimeout(jobId, roundNumber, participantIds) {
  const ms = ROUND_TIMEOUT_MINUTES * 60 * 1000;

  roundTimers[jobId] = setTimeout(async () => {
    console.warn(`[Orchestrator] Round ${roundNumber} timed out for job ${jobId}`);

    const submittedCount = Object.keys(weightBuffer[jobId] || {}).length;

    if (submittedCount >= MIN_CLIENTS) {
      // Enough weights to proceed — aggregate with what we have
      console.log(`[Orchestrator] Proceeding with ${submittedCount} weights (timeout)`);

      // Mark missing participants as disconnected
      const submitted    = Object.keys(weightBuffer[jobId]);
      const disconnected = participantIds.filter((id) => !submitted.includes(id));

      if (disconnected.length > 0) {
        await Participant.updateMany(
          { jobId, companyId: { $in: disconnected } },
          { $set: { status: PARTICIPANT_STATUS.DISCONNECTED } }
        );

        disconnected.forEach((companyId) => {
          emitter.emit(WS_EVENTS.PARTICIPANT_DISCONNECTED, { companyId, jobId, round: roundNumber });
        });
      }

      await _aggregateRound(jobId, roundNumber);

    } else {
      // Not enough weights — fail the job
      await _failJob(
        jobId,
        `Insufficient participants after timeout: ${submittedCount}/${MIN_CLIENTS} required`
      );
    }
  }, ms);
}

function _clearRoundTimeout(jobId) {
  if (roundTimers[jobId]) {
    clearTimeout(roundTimers[jobId]);
    delete roundTimers[jobId];
  }
}

// ─── Recovery on server restart ───────────────────────────────────────────────

/**
 * Called on app startup. If a job was active when the server crashed,
 * re-broadcast the current round so clients can reconnect and resubmit.
 */
async function recoverActiveJob() {
  const activeJob = await jobManager.getActiveJob();
  if (!activeJob) return;

  console.log(`[Orchestrator] Recovering active job ${activeJob.jobId} at round ${activeJob.currentRound}`);

  weightBuffer[activeJob.jobId] = {};

  emitter.emit(WS_EVENTS.ROUND_STARTED, {
    jobId:          activeJob.jobId,
    round:          activeJob.currentRound,
    modelAvailable: true,
    recovered:      true,
  });

  _setRoundTimeout(activeJob.jobId, activeJob.currentRound, activeJob.participantIds);
}

module.exports = { startJob, receiveWeights, recoverActiveJob };
// src/services/jobManager.js
const { v4: uuidv4 }  = require('uuid');
const TrainingJob      = require('../models/TrainingJob');
const TrainingRound    = require('../models/TrainingRound');
const Participant      = require('../models/Participant');
const { JOB_STATUS, ROUND_STATUS, PARTICIPANT_STATUS } = require('../config/constants');
const { DEFAULT_ROUNDS, MIN_CLIENTS } = require('../config/env');

// ─── Job CRUD ─────────────────────────────────────────────────────────────────

/**
 * Creates a new TrainingJob and moves the queued participants into it.
 *
 * @param {string[]} participantIds - companyIds confirmed for this job
 * @param {object}   config         - optional overrides: { totalRounds, minParticipants, trainingConfig }
 * @returns {TrainingJob}
 */
async function createJob(participantIds, config = {}) {
  const jobId = `job_${Date.now()}_${uuidv4().slice(0, 8)}`;

  const job = await TrainingJob.create({
    jobId,
    status:          JOB_STATUS.INITIALIZING,
    participantIds,
    currentRound:    0,
    totalRounds:     config.totalRounds     || DEFAULT_ROUNDS,
    minParticipants: config.minParticipants || MIN_CLIENTS,
    startedAt:       new Date(),
    config:          config.trainingConfig  || {},
  });

  // Move participants from QUEUED → TRAINING
  await Participant.updateMany(
    { companyId: { $in: participantIds }, jobId: null },
    {
      $set: {
        jobId,
        status:            PARTICIPANT_STATUS.TRAINING,
        trainingStartedAt: new Date(),
      },
    }
  );

  console.log(`[JobManager] Created job ${jobId} with ${participantIds.length} participants`);

  return job;
}

/**
 * Finds the currently active job — any job that is not COMPLETE or FAILED.
 * Returns null if no active job exists.
 *
 * @returns {TrainingJob|null}
 */
async function getActiveJob() {
  return TrainingJob.findOne({
    status: {
      $in: [
        JOB_STATUS.INITIALIZING,
        JOB_STATUS.ROUND_IN_PROGRESS,
        JOB_STATUS.AGGREGATING,
        JOB_STATUS.FINALIZING,
      ],
    },
  });
}

/**
 * Fetches a single job by its jobId string.
 *
 * @param {string} jobId
 * @returns {TrainingJob|null}
 */
async function getJobById(jobId) {
  return TrainingJob.findOne({ jobId });
}

/**
 * Returns all completed jobs, newest first.
 * Used by the history endpoint and model registry.
 *
 * @returns {TrainingJob[]}
 */
async function getJobHistory() {
  return TrainingJob.find({ status: JOB_STATUS.COMPLETE })
    .sort({ completedAt: -1 })
    .select('jobId completedAt totalRounds participantIds modelId');
}

// ─── Status transitions ───────────────────────────────────────────────────────

/**
 * Generic status updater. Merges extra fields into the document.
 *
 * @param {string} jobId
 * @param {string} status  - one of JOB_STATUS values
 * @param {object} extra   - additional fields to set (e.g. currentRound, globalModelVersion)
 * @returns {TrainingJob}
 */
async function updateJobStatus(jobId, status, extra = {}) {
  const updated = await TrainingJob.findOneAndUpdate(
    { jobId },
    { $set: { status, ...extra, updatedAt: new Date() } },
    { new: true }
  );

  console.log(`[JobManager] Job ${jobId} → ${status}`);

  return updated;
}

/**
 * Marks a job as COMPLETE and links it to the produced model.
 *
 * @param {string}   jobId
 * @param {ObjectId} modelId - the _id of the Model document
 * @returns {TrainingJob}
 */
async function markJobComplete(jobId, modelId) {
  return updateJobStatus(jobId, JOB_STATUS.COMPLETE, {
    modelId,
    completedAt: new Date(),
  });
}

/**
 * Marks a job as FAILED with a human-readable reason.
 *
 * @param {string} jobId
 * @param {string} reason
 * @returns {TrainingJob}
 */
async function markJobFailed(jobId, reason) {
  return updateJobStatus(jobId, JOB_STATUS.FAILED, {
    failureReason: reason,
    completedAt:   new Date(),
  });
}

// ─── Round CRUD ───────────────────────────────────────────────────────────────

/**
 * Creates a new TrainingRound document at the start of each round.
 *
 * @param {string}   jobId
 * @param {number}   roundNumber
 * @param {string[]} participantIds - companies expected to submit weights
 * @returns {TrainingRound}
 */
async function createRound(jobId, roundNumber, participantIds) {
  const round = await TrainingRound.create({
    jobId,
    roundNumber,
    status:               ROUND_STATUS.IN_PROGRESS,
    participantsExpected: participantIds,
    participantsSubmitted: [],
    startedAt:            new Date(),
  });

  console.log(`[JobManager] Created round ${roundNumber} for job ${jobId}`);

  return round;
}

/**
 * Fetches a specific round by job + round number.
 *
 * @param {string} jobId
 * @param {number} roundNumber
 * @returns {TrainingRound|null}
 */
async function getRound(jobId, roundNumber) {
  return TrainingRound.findOne({ jobId, roundNumber });
}

/**
 * Records a company's weight submission for the current round.
 * Uses $addToSet so duplicate calls are safe.
 *
 * @param {string} jobId
 * @param {number} roundNumber
 * @param {string} companyId
 * @returns {TrainingRound}
 */
async function recordWeightSubmission(jobId, roundNumber, companyId) {
  const updated = await TrainingRound.findOneAndUpdate(
    { jobId, roundNumber },
    {
      $addToSet: { participantsSubmitted: companyId },
    },
    { new: true }
  );

  console.log(`[JobManager] Weight submission recorded — ${companyId} / round ${roundNumber}`);

  return updated;
}

/**
 * Marks a round as COMPLETE and stores the aggregation metrics.
 *
 * @param {string} jobId
 * @param {number} roundNumber
 * @param {object} metrics - { avgLoss, accuracyDelta, aggregationStrategy }
 * @returns {TrainingRound}
 */
async function markRoundComplete(jobId, roundNumber, metrics = {}) {
  const updated = await TrainingRound.findOneAndUpdate(
    { jobId, roundNumber },
    {
      $set: {
        status:             ROUND_STATUS.COMPLETE,
        aggregationMetrics: metrics,
        aggregatedAt:       new Date(),
        completedAt:        new Date(),
      },
    },
    { new: true }
  );

  console.log(`[JobManager] Round ${roundNumber} marked complete for job ${jobId}`);

  return updated;
}

/**
 * Marks a round as FAILED.
 *
 * @param {string} jobId
 * @param {number} roundNumber
 * @returns {TrainingRound}
 */
async function markRoundFailed(jobId, roundNumber) {
  return TrainingRound.findOneAndUpdate(
    { jobId, roundNumber },
    { $set: { status: ROUND_STATUS.FAILED, completedAt: new Date() } },
    { new: true }
  );
}

// ─── Participant helpers ───────────────────────────────────────────────────────

/**
 * Returns all participant records for a given job.
 *
 * @param {string} jobId
 * @returns {Participant[]}
 */
async function getParticipants(jobId) {
  return Participant.find({ jobId });
}

/**
 * Marks a single participant as DISCONNECTED.
 *
 * @param {string} jobId
 * @param {string} companyId
 */
async function markParticipantDisconnected(jobId, companyId) {
  await Participant.findOneAndUpdate(
    { jobId, companyId },
    { $set: { status: PARTICIPANT_STATUS.DISCONNECTED, disconnectedAt: new Date() } }
  );

  console.log(`[JobManager] Participant ${companyId} marked DISCONNECTED in job ${jobId}`);
}

module.exports = {
  // Job
  createJob,
  getActiveJob,
  getJobById,
  getJobHistory,
  updateJobStatus,
  markJobComplete,
  markJobFailed,
  // Round
  createRound,
  getRound,
  recordWeightSubmission,
  markRoundComplete,
  markRoundFailed,
  // Participant
  getParticipants,
  markParticipantDisconnected,
};
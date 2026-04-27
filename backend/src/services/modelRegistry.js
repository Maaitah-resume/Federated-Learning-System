// src/services/modelRegistry.js
const fs          = require('fs');
const path        = require('path');
const { v4: uuidv4 } = require('uuid');
const ModelDoc    = require('../models/Models');
const TrainingJob = require('../models/TrainingJob');
const { MODEL_STATUS } = require('../config/constants');
const { MODEL_STORE_PATH } = require('../config/env');

// ─── Register ─────────────────────────────────────────────────────────────────

/**
 * Called by the orchestrator after Python finalises the model.
 * Creates a Model document so companies can discover and download it.
 *
 * @param {string} jobId        - The training job that produced this model
 * @param {string} artifactPath - Absolute path to global_model.pt on the shared volume
 * @param {object} meta         - { checksum, sizeBytes }
 * @returns {Model} the saved Mongoose document
 */
async function register(jobId, artifactPath, meta = {}) {
  const job = await TrainingJob.findOne({ jobId });

  const modelId = `model_${jobId}_${uuidv4().slice(0, 6)}`;
  const version = `1.0.0`;

  const model = await ModelDoc.create({
    modelId,
    jobId,
    version,
    status:       MODEL_STATUS.AVAILABLE,
    artifactPath,
    checksum:     meta.checksum  || null,
    sizeBytes:    meta.sizeBytes || _getFileSizeBytes(artifactPath),
    architecture: 'IDSNet_v2',
    trainingMetrics: {
      finalLoss:         meta.finalLoss         || null,
      finalAccuracy:     meta.finalAccuracy      || null,
      roundsCompleted:   job?.totalRounds        || null,
      totalParticipants: job?.participantIds?.length || null,
    },
  });

  console.log(`[ModelRegistry] Registered model ${modelId} for job ${jobId} at ${artifactPath}`);

  return model;
}

// ─── List ─────────────────────────────────────────────────────────────────────

/**
 * Returns all AVAILABLE models that the given company participated in.
 *
 * @param {string} companyId
 * @returns {Model[]}
 */
async function listForCompany(companyId) {
  // Find all jobs this company was a participant in
  const jobs = await TrainingJob.find({
    participantIds: companyId,
    status:         'COMPLETE',
  }).select('jobId');

  const jobIds = jobs.map((j) => j.jobId);

  return ModelDoc.find({
    jobId:  { $in: jobIds },
    status: MODEL_STATUS.AVAILABLE,
  }).sort({ createdAt: -1 });
}

// ─── Get one ──────────────────────────────────────────────────────────────────

/**
 * Fetch a single model by modelId.
 * Throws 404 if not found, 403 if company did not participate.
 *
 * @param {string} modelId
 * @param {string} companyId
 * @returns {Model}
 */
async function getForCompany(modelId, companyId) {
  const model = await ModelDoc.findOne({ modelId });

  if (!model) {
    throw Object.assign(new Error('Model not found'), { status: 404, code: 'NOT_FOUND' });
  }

  // Verify participation
  const job = await TrainingJob.findOne({ jobId: model.jobId });
  if (!job || !job.participantIds.includes(companyId)) {
    throw Object.assign(
      new Error('You are not a participant of the job that produced this model'),
      { status: 403, code: 'FORBIDDEN' }
    );
  }

  return model;
}

// ─── Download stream ──────────────────────────────────────────────────────────

/**
 * Returns a readable stream for the model .pt file.
 * Verifies the file exists on disk before streaming.
 *
 * @param {string} modelId
 * @param {string} companyId
 * @returns {{ stream: ReadStream, model: Model }}
 */
async function getDownloadStream(modelId, companyId) {
  const model = await getForCompany(modelId, companyId);

  if (model.status !== MODEL_STATUS.AVAILABLE) {
    throw Object.assign(
      new Error(`Model is not ready for download (status: ${model.status})`),
      { status: 409, code: 'NOT_READY' }
    );
  }

  if (!model.artifactPath || !fs.existsSync(model.artifactPath)) {
    throw Object.assign(
      new Error('Model file not found on server'),
      { status: 404, code: 'FILE_NOT_FOUND' }
    );
  }

  const stream = fs.createReadStream(model.artifactPath);

  return { stream, model };
}

// ─── Archive ──────────────────────────────────────────────────────────────────

/**
 * Marks a model as ARCHIVED so it no longer appears in listings.
 * Does not delete the file from disk.
 *
 * @param {string} modelId
 */
async function archive(modelId) {
  await ModelDoc.findOneAndUpdate(
    { modelId },
    { $set: { status: MODEL_STATUS.ARCHIVED } }
  );
  console.log(`[ModelRegistry] Archived model ${modelId}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _getFileSizeBytes(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

module.exports = { register, listForCompany, getForCompany, getDownloadStream, archive };

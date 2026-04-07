// src/models/TrainingJob.js
const mongoose = require('mongoose');

// All possible states a job moves through
const JOB_STATUSES = [
  'WAITING',           // queue threshold not yet met
  'INITIALIZING',      // Python initialising global model
  'ROUND_IN_PROGRESS', // companies training locally
  'AGGREGATING',       // Python running FedAvg
  'FINALIZING',        // Python saving global_model.pt
  'COMPLETE',          // model available for download
  'FAILED',            // unrecoverable error
];

const trainingJobSchema = new mongoose.Schema(
  {
    jobId: {
      type:     String,
      required: true,
      unique:   true,
    },
    status: {
      type:    String,
      enum:    JOB_STATUSES,
      default: 'WAITING',
    },
    currentRound: {
      type:    Number,
      default: 0,
    },
    totalRounds: {
      type:     Number,
      required: true,
    },
    minParticipants: {
      type:     Number,
      required: true,
    },
    // companyId strings of all companies locked into this job
    participantIds: [
      { type: String },
    ],
    globalModelVersion: {
      type: String, // e.g. "IDSNet_v2"
    },
    // Populated once training completes
    modelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'Model',
    },
    startedAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    failureReason: {
      type: String,
    },
    // Hyperparameters passed to the Python FL service
    config: {
      learningRate:        { type: Number, default: 0.01 },
      batchSize:           { type: Number, default: 32 },
      localEpochs:         { type: Number, default: 3 },
      aggregationStrategy: { type: String, default: 'fedavg' },
    },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
trainingJobSchema.index({ status:    1 });
trainingJobSchema.index({ createdAt: -1 });

module.exports = mongoose.model('TrainingJob', trainingJobSchema);
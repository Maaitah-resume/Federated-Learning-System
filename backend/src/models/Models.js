// src/models/Model.js
const mongoose = require('mongoose');

// Represents the final trained model artifact produced at the end of a job.
// The actual .pt file lives on the shared Docker volume.
// Node streams it to browsers via GET /models/:modelId/download.

const MODEL_STATUSES = [
  'PENDING',   // Python is still finalising
  'AVAILABLE', // file written, ready to download
  'ARCHIVED',  // no longer listed but file kept on disk
];

const modelSchema = new mongoose.Schema(
  {
    modelId: {
      type:     String,
      required: true,
      unique:   true,
    },
    jobId: {
      type:     String,
      required: true,
    },
    version: {
      type:     String,
      required: true, // e.g. "1.0.0"
    },
    status: {
      type:    String,
      enum:    MODEL_STATUSES,
      default: 'PENDING',
    },
    // Absolute path on the shared volume where Python wrote the .pt file
    // e.g. /models/job_123/global_model.pt
    artifactPath: {
      type: String,
    },
    // SHA-256 hash of the .pt file for integrity verification on download
    checksum: {
      type: String,
    },
    sizeBytes: {
      type: Number,
    },
    architecture: {
      type:    String,
      default: 'IDSNet_v2',
    },
    // Performance metrics recorded at end of final round
    trainingMetrics: {
      finalLoss:         { type: Number },
      finalAccuracy:     { type: Number },
      roundsCompleted:   { type: Number },
      totalParticipants: { type: Number },
    },
    // Optional expiry — useful for cleanup jobs
    availableUntil: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
modelSchema.index({ jobId:  1 });
modelSchema.index({ status: 1 });

module.exports = mongoose.model('Model', modelSchema);
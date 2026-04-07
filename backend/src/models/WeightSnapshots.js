// src/models/WeightSnapshot.js
const mongoose = require('mongoose');

// One record per company per round.
// Stores only METADATA — the actual weight bytes live on the filesystem volume.
// After Python aggregates, isAggregated is set to true and the file is deleted
// from disk. This protects company privacy: raw weights are never persisted long-term.

const weightSnapshotSchema = new mongoose.Schema(
  {
    jobId: {
      type:     String,
      required: true,
    },
    roundNumber: {
      type:     Number,
      required: true,
    },
    companyId: {
      type:     String,
      required: true,
    },
    // Path to the encrypted weight file on the shared Docker volume.
    // Format: weights/{jobId}/round_{N}/{companyId}.bin
    storagePath: {
      type:     String,
      required: true,
    },
    encryptionKeyRef: {
      type: String, // reference to key in secrets manager (future use)
    },
    // Self-reported by the company's training agent.
    // Used by Python FedAvg to weight the contribution proportionally.
    datasetSize: {
      type:    Number,
      default: 0,
    },
    submittedAt: {
      type:    Date,
      default: Date.now,
    },
    // Set to true once Python has consumed these weights in FedAvg
    isAggregated: {
      type:    Boolean,
      default: false,
    },
    // Set when the weight file is deleted from disk after aggregation
    deletedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
// One snapshot per company per round per job
weightSnapshotSchema.index(
  { jobId: 1, roundNumber: 1, companyId: 1 },
  { unique: true }
);

module.exports = mongoose.model('WeightSnapshot', weightSnapshotSchema);
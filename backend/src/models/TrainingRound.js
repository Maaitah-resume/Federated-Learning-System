// src/models/TrainingRound.js
const mongoose = require('mongoose');

const ROUND_STATUSES = [
  'IN_PROGRESS',  // global model distributed, waiting for local weights
  'AGGREGATING',  // all weights received, Python running FedAvg
  'COMPLETE',     // aggregation done, metrics stored
  'FAILED',       // timeout or insufficient participants
];

const trainingRoundSchema = new mongoose.Schema(
  {
    jobId: {
      type:     String,
      required: true,
    },
    roundNumber: {
      type:     Number,
      required: true,
    },
    status: {
      type:    String,
      enum:    ROUND_STATUSES,
      default: 'IN_PROGRESS',
    },
    // Companies expected to submit weights this round
    participantsExpected: [
      { type: String }, // companyId strings
    ],
    // Companies that have actually submitted
    participantsSubmitted: [
      { type: String }, // companyId strings
    ],
    // Filled in by Python after FedAvg completes
    aggregationMetrics: {
      avgLoss:             { type: Number },
      accuracyDelta:       { type: Number },
      aggregationStrategy: { type: String, default: 'fedavg' },
    },
    startedAt: {
      type:    Date,
      default: Date.now,
    },
    aggregatedAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
// One round record per job per round number
trainingRoundSchema.index({ jobId: 1, roundNumber: 1 }, { unique: true });

module.exports = mongoose.model('TrainingRound', trainingRoundSchema);
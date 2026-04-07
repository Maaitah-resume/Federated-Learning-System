// src/models/Participant.js
const mongoose = require('mongoose');

// A participant record is created in two situations:
//   1. Company joins the queue  → jobId is null, status is QUEUED
//   2. Training starts          → jobId is set,  status moves to TRAINING
const PARTICIPANT_STATUSES = [
  'QUEUED',       // waiting in pre-training queue
  'TRAINING',     // actively in a job, training locally
  'SUBMITTED',    // submitted weights for current round
  'DISCONNECTED', // lost connection mid-job
  'DONE',         // job complete, model available
];

const participantSchema = new mongoose.Schema(
  {
    // null while queued, set once job starts
    jobId: {
      type:    String,
      default: null,
    },
    companyId: {
      type:     String,
      required: true,
    },
    status: {
      type:    String,
      enum:    PARTICIPANT_STATUSES,
      default: 'QUEUED',
    },
    joinedQueueAt: {
      type:    Date,
      default: Date.now,
    },
    trainingStartedAt: {
      type: Date,
    },
    disconnectedAt: {
      type: Date,
    },
    lastHeartbeatAt: {
      type: Date,
    },
    roundsCompleted: {
      type:    Number,
      default: 0,
    },
    currentRound: {
      type:    Number,
      default: 0,
    },
    // Self-reported by the client training agent.
    // Used by FedAvg to weight this company's contribution proportionally.
    datasetSize: {
      type:    Number,
      default: 0,
    },
    // One entry per round this company submitted weights for
    weightsSubmitted: [
      {
        round:       { type: Number },
        submittedAt: { type: Date },
        snapshotId:  { type: mongoose.Schema.Types.ObjectId, ref: 'WeightSnapshot' },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
// Compound unique: one record per company per job
participantSchema.index({ jobId: 1, companyId: 1 }, { unique: true, sparse: true });
participantSchema.index({ status: 1 });

module.exports = mongoose.model('Participant', participantSchema);
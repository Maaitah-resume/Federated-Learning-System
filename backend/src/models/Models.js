const mongoose = require('mongoose');

const modelSchema = new mongoose.Schema({
  modelId:      { type: String, required: true, unique: true, index: true },
  jobId:        { type: String, index: true },
  version:      { type: String, default: '1.0.0' },
  status:       { type: String, default: 'AVAILABLE', enum: ['AVAILABLE', 'ARCHIVED'] },
  architecture: { type: String, default: 'IDSNet_v2' },
  artifactPath: { type: String },
  checksum:     { type: String },
  sizeBytes:    { type: Number, default: 0 },
  participants: [{ type: String }],

  // Actual model weights stored as base64 — served as .pt on download
  weightsB64:   { type: String },

  trainingMetrics: {
    finalAccuracy:     { type: Number },
    finalLoss:         { type: Number },
    roundsCompleted:   { type: Number },
    totalParticipants: { type: Number },
  },

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Model', modelSchema);

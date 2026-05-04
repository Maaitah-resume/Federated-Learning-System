const mongoose = require('mongoose');

const trainingMetricSchema = new mongoose.Schema({
  jobId:        { type: String, required: true, index: true },
  round:        { type: Number, required: true },
  companyId:    { type: String, required: true },  // 'global' for aggregated, or participant ID for local

  // Metrics
  accuracy:     { type: Number },
  loss:         { type: Number },
  f1Score:      { type: Number },
  precision:    { type: Number },
  recall:       { type: Number },

  // Training info
  datasetSize:  { type: Number },
  epochsRun:    { type: Number },
  durationMs:   { type: Number },

  // Type: 'local' (per participant) or 'global' (aggregated)
  type:         { type: String, enum: ['local', 'global'], required: true, index: true },

  createdAt:    { type: Date, default: Date.now },
});

trainingMetricSchema.index({ jobId: 1, round: 1, type: 1 });

module.exports = mongoose.model('TrainingMetric', trainingMetricSchema);

const mongoose = require('mongoose');

const modelSchema = new mongoose.Schema({
  modelId:      { type: String, required: true, unique: true },
  jobId:        { type: String, index: true },
  name:         { type: String, required: true },
  version:      { type: String },
  rounds:       { type: Number },
  accuracy:     { type: Number },
  loss:         { type: Number },
  participants: [{ type: String }],
  fileSize:     { type: Number, default: 0 },
  createdAt:    { type: Date,   default: Date.now },
});

module.exports = mongoose.model('Model', modelSchema);

// backend/src/models/SystemConfig.js
const mongoose = require('mongoose');

const systemConfigSchema = new mongoose.Schema({
  key:       { type: String, required: true, unique: true },
  value:     { type: mongoose.Schema.Types.Mixed, required: true },
  updatedBy: { type: String, default: 'admin' },
  updatedAt: { type: Date, default: Date.now },
});

const SystemConfig = mongoose.model('SystemConfig', systemConfigSchema);

// Default config values
const DEFAULTS = {
  MIN_CLIENTS:    3,
  DEFAULT_ROUNDS: 10,
  LEARNING_RATE:  0.001,
};

async function getConfig(key) {
  const doc = await SystemConfig.findOne({ key });
  if (doc) return doc.value;
  return DEFAULTS[key] ?? null;
}

async function setConfig(key, value, updatedBy = 'admin') {
  await SystemConfig.findOneAndUpdate(
    { key },
    { key, value, updatedBy, updatedAt: new Date() },
    { upsert: true }
  );
}

async function getAllConfig() {
  const docs    = await SystemConfig.find({});
  const config  = { ...DEFAULTS };
  for (const doc of docs) {
    config[doc.key] = doc.value;
  }
  return config;
}

module.exports = { SystemConfig, getConfig, setConfig, getAllConfig };

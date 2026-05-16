// backend/src/models/SystemConfig.js
//
// FIX: DEFAULTS now matches actual expected production values.
// Previously DEFAULTS had MIN_CLIENTS:3 while env fallback was '2', causing
// inconsistency.  Now DEFAULTS is the single source of truth for fallback
// values when no DB document exists yet.
//
// getConfig() contract:
//   1. If a DB document exists for the key  → return doc.value
//   2. Else if key is in DEFAULTS           → return DEFAULTS[key]
//   3. Else                                 → return null
//
// Callers must NOT apply their own "|| default" fallback on top of this,
// because doing so hides the admin-saved value when getConfig returns a
// falsy-but-valid value (e.g. 0 or empty string).
//
const mongoose = require('mongoose');

const systemConfigSchema = new mongoose.Schema({
  key:       { type: String, required: true, unique: true },
  value:     { type: mongoose.Schema.Types.Mixed, required: true },
  updatedBy: { type: String, default: 'admin' },
  updatedAt: { type: Date,   default: Date.now },
});

const SystemConfig = mongoose.model('SystemConfig', systemConfigSchema);

// ── Default config values ─────────────────────────────────────────────────────
// These are used only when no DB document exists for a key.
// The admin PUT /api/admin/config endpoint writes to MongoDB, so after the
// admin saves once these defaults are no longer consulted for that key.
const DEFAULTS = {
  MIN_CLIENTS:    2,      // minimum participants required to start a training job
  DEFAULT_ROUNDS: 5,      // federated rounds per session
  LEARNING_RATE:  0.001,  // meta-aggregator learning rate
  ROUND_TIMEOUT_MS: 600000, // 10 min round timeout
};

async function getConfig(key) {
  const doc = await SystemConfig.findOne({ key });
  if (doc !== null && doc !== undefined) return doc.value;
  return DEFAULTS[key] ?? null;
}

async function setConfig(key, value, updatedBy = 'admin') {
  await SystemConfig.findOneAndUpdate(
    { key },
    { key, value, updatedBy, updatedAt: new Date() },
    { upsert: true, new: true }
  );
}

async function getAllConfig() {
  const docs   = await SystemConfig.find({});
  const config = { ...DEFAULTS };
  for (const doc of docs) {
    config[doc.key] = doc.value;
  }
  return config;
}

module.exports = { SystemConfig, getConfig, setConfig, getAllConfig };

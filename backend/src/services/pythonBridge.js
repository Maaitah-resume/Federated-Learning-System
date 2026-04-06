// src/services/pythonBridge.js
const axios = require('axios');
const { PYTHON_FL_URL, PYTHON_TIMEOUT } = require('../config/env');

// ─── Axios client ─────────────────────────────────────────────────────────────

const client = axios.create({
  baseURL: PYTHON_FL_URL,                  // e.g. http://python-fl-server:8000
  timeout: PYTHON_TIMEOUT,                 // default 600,000ms (10 min) for long training calls
  headers: { 'Content-Type': 'application/json' },
});

// Log every outgoing request in dev
client.interceptors.request.use((config) => {
  console.log(`[PythonBridge] → ${config.method.toUpperCase()} ${config.baseURL}${config.url}`);
  return config;
});

// ─── Error normaliser ─────────────────────────────────────────────────────────

/**
 * Wraps any Axios error into a clean internal error with status 502.
 * All bridge methods call this on failure so the orchestrator never
 * has to deal with raw Axios errors.
 */
function _handleError(err, context) {
  const httpStatus = err.response?.status;
  const detail     = err.response?.data?.detail || err.response?.data?.message || err.message;
  const isTimeout  = err.code === 'ECONNABORTED';

  const message = isTimeout
    ? `Python FL service timed out during: ${context}`
    : `Python FL service error during ${context}: [${httpStatus || 'UNREACHABLE'}] ${detail}`;

  console.error(`[PythonBridge] ${message}`);

  throw Object.assign(new Error(message), {
    status: 502,
    code:   'FL_SERVICE_ERROR',
  });
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

/**
 * POST /fl/initialize
 * Initialises the global model for a new training job.
 *
 * Sends:   { job_id, model_version }
 * Returns: { weights_b64, model_architecture, num_params }
 *
 * @param {string} jobId
 * @param {string} modelVersion - e.g. "IDSNet_v2"
 */
async function initialize(jobId, modelVersion = 'IDSNet_v2') {
  try {
    const { data } = await client.post('/fl/initialize', {
      job_id:        jobId,
      model_version: modelVersion,
    });

    console.log(`[PythonBridge] Model initialised — params: ${data.num_params}`);

    return data; // { weights_b64, model_architecture, num_params }
  } catch (err) {
    _handleError(err, 'initialize');
  }
}

/**
 * POST /fl/distribute
 * Fetches the current round model weights so Node can serve them to companies.
 *
 * Sends:   { job_id, round, participant_ids[] }
 * Returns: { round_model_b64, round_id }
 *
 * @param {string}   jobId
 * @param {number}   round
 * @param {string[]} participantIds
 */
async function distribute(jobId, round, participantIds) {
  try {
    const { data } = await client.post('/fl/distribute', {
      job_id:          jobId,
      round,
      participant_ids: participantIds,
    });

    return data; // { round_model_b64, round_id }
  } catch (err) {
    _handleError(err, 'distribute');
  }
}

/**
 * POST /fl/receive-weights
 * Forwards a single company's local weights into the Python weight buffer.
 * Python collects these until /fl/aggregate is called.
 *
 * Sends:   { job_id, round, company_id, weights_b64, dataset_size }
 * Returns: { received: true, waiting_for: N }
 *
 * @param {string} jobId
 * @param {number} round
 * @param {string} companyId
 * @param {string} weightsB64   - base64-encoded PyTorch state_dict
 * @param {number} datasetSize  - number of local training samples (used in FedAvg weighting)
 */
async function receiveWeights(jobId, round, companyId, weightsB64, datasetSize = 0) {
  try {
    const { data } = await client.post('/fl/receive-weights', {
      job_id:       jobId,
      round,
      company_id:   companyId,
      weights_b64:  weightsB64,
      dataset_size: datasetSize,
    });

    console.log(`[PythonBridge] Weights buffered for ${companyId} — waiting for ${data.waiting_for} more`);

    return data; // { received: true, waiting_for: N }
  } catch (err) {
    _handleError(err, 'receiveWeights');
  }
}

/**
 * POST /fl/aggregate
 * Triggers FedAvg aggregation on all buffered weights for this round.
 * Python runs the aggregation and returns the new global weights + metrics.
 *
 * Sends:   { job_id, round }
 * Returns: { aggregated_weights_b64, metrics: { avg_loss, delta_accuracy } }
 *
 * @param {string} jobId
 * @param {number} round
 */
async function aggregate(jobId, round) {
  try {
    const { data } = await client.post('/fl/aggregate', {
      job_id: jobId,
      round,
    });

    console.log(`[PythonBridge] Aggregation complete — loss: ${data.metrics?.avg_loss}`);

    return data; // { aggregated_weights_b64, metrics }
  } catch (err) {
    _handleError(err, 'aggregate');
  }
}

/**
 * POST /fl/finalize
 * Writes the final global_model.pt to the shared Docker volume.
 * Called once after the last round completes.
 *
 * Sends:   { job_id }
 * Returns: { model_path, checksum, size_bytes }
 *
 * @param {string} jobId
 */
async function finalize(jobId) {
  try {
    const { data } = await client.post('/fl/finalize', {
      job_id: jobId,
    });

    console.log(`[PythonBridge] Model saved to ${data.model_path} (${data.size_bytes} bytes)`);

    return data; // { model_path, checksum, size_bytes }
  } catch (err) {
    _handleError(err, 'finalize');
  }
}

/**
 * GET /fl/status/:jobId
 * Fetches the current status of the job from the Python side.
 * Useful for debugging and health checks.
 *
 * Returns: { round, status, participants_submitted }
 *
 * @param {string} jobId
 */
async function getStatus(jobId) {
  try {
    const { data } = await client.get(`/fl/status/${jobId}`);
    return data;
  } catch (err) {
    _handleError(err, 'getStatus');
  }
}

/**
 * GET /health
 * Lightweight ping to check if the Python service is reachable.
 * Returns null instead of throwing — used for the /health endpoint.
 *
 * @returns {object|null}
 */
async function healthCheck() {
  try {
    const { data } = await client.get('/health', { timeout: 5000 });
    return data;
  } catch {
    return null;
  }
}

module.exports = {
  initialize,
  distribute,
  receiveWeights,
  aggregate,
  finalize,
  getStatus,
  healthCheck,
};